// Flowko U27: cancel and move of a business booking (W7–W9). Staff cancel (W7) and the customer's „Odpovej“ link
// (W8) set the booking CANCELLED in place, keep its step copy (history; every Flowko reader filters status) and log
// a CANCELLED action; the idempotency extension clears the key, so the time can be booked again. A move (W9) keeps
// the worker, the services and the uid: it re-places the booking's own step copy at the new start under the
// worker's advisory lock, re-runs the U24 fit with the booking left out, and rewrites the times, the key, the step
// rows and the U22 reminder claims in place. Cal's handleCancelBooking is not used (it refuses a Cal-locked
// organizer and disableCancelling); nothing here loads a user with a top-level user query (the excludeLockedUsers
// extension would hide a locked worker). Mails go out after the commit and never undo a write. Server only.
// Flowko U28: a move never targets a start in the past (in_past) nor moves a booking that has ended
// (booking_not_active); its needs_confirm carries googleUnavailable (R7).
import { type Interval, placeSteps, type ServiceStep, totalMinutes } from "@calcom/lib/flowkoSalon";
import { IdempotencyKeyService } from "@calcom/lib/idempotencyKey/idempotencyKeyService";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBookingActionKind } from "@calcom/prisma/enums";
import { getBusinessAccess, requireBookingAccess } from "./access";
import {
  type ActorRef,
  fitUnderLock,
  isIdempotencyKeyConflict,
  isServiceForeignKeyRace, // Flowko U29b
  loadBookableWorker,
  lockWorkerAdvisory,
  NeedsConfirm,
  needsConfirmResult,
  placeVisitDay,
  problemKinds,
  resolveActor,
  sendMailAfterCommit,
  type WriteResult,
  type WriterDeps,
} from "./bookingWriter";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError } from "./errors";
import { type BusinessBookingRef, businessBookingById, businessBookingByUid } from "./mirror";

type Tx = Prisma.TransactionClient;

const MINUTE_MS = 60_000;
/** W7: the cancellation reason's maximum length. */
const MAX_REASON_LENGTH = 500;
/** W7/W8: the states a cancel may end (the ones that hold the worker's time). */
const CANCELLABLE_STATUSES = [BookingStatus.ACCEPTED, BookingStatus.PENDING, BookingStatus.AWAITING_HOST];

export type CancelBookingInput = ActorRef & { bookingId: number; reason?: string | null };
export type CustomerCancelInput = { uid: string; reason?: string | null; sessionUserId: number | null };
export type MoveBookingInput = ActorRef & { bookingId: number; start: Date; confirmOverride: boolean };

/** Optional, trimmed, empty = none; longer than 500 characters is bad_booking. */
function cancellationReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  if (typeof reason !== "string") throw new FlowkoBusinessError("bad_booking");
  const trimmed = reason.trim();
  if (trimmed.length > MAX_REASON_LENGTH) throw new FlowkoBusinessError("bad_booking");
  return trimmed === "" ? null : trimmed;
}

/** M6: the business booking with this id, else not_business_booking. */
async function requireBusinessBooking(db: FlowkoDb, bookingId: number): Promise<BusinessBookingRef> {
  const ref = await businessBookingById(db, bookingId);
  if (!ref) throw new FlowkoBusinessError("not_business_booking");
  return ref;
}

type CancelActor = { actorMemberId: number | null; actorName: string; userId: number | null };

/**
 * The guarded cancel: one conditional update (status still cancellable and `timeGuard` still true), so two
 * cancels at once end in one CANCELLED action and the other in booking_not_active. Step rows stay.
 */
async function cancelInTx(
  tx: Tx,
  ref: BusinessBookingRef,
  timeGuard: Prisma.BookingWhereInput,
  reason: string | null,
  actor: CancelActor
): Promise<void> {
  const { count } = await tx.booking.updateMany({
    where: { id: ref.bookingId, status: { in: CANCELLABLE_STATUSES }, ...timeGuard },
    // The idempotency extension sets idempotencyKey null for a CANCELLED write.
    data: {
      status: BookingStatus.CANCELLED,
      cancellationReason: reason,
      cancelledBy: null,
      iCalSequence: { increment: 1 },
    },
  });
  if (count !== 1) throw new FlowkoBusinessError("booking_not_active");
  await tx.flowkoBookingAction.create({
    data: {
      bookingId: ref.bookingId,
      businessId: ref.businessId,
      action: FlowkoBookingActionKind.CANCELLED,
      actorMemberId: actor.actorMemberId,
      actorName: actor.actorName,
      userId: actor.userId,
    },
  });
}

/**
 * W7: staff cancel. Rights = act on the booking (U25; a missing id answers like a foreign one: forbidden); only a
 * business booking (else not_business_booking) that is ACCEPTED, PENDING or AWAITING_HOST and has not ended (else
 * booking_not_active). Works for a booking of a locked worker. Mails after the commit unless `sendMails` false.
 */
export async function cancelBusinessBooking(
  db: FlowkoDb,
  actorUserId: number,
  input: CancelBookingInput,
  now: Date,
  deps: { sendMails?: boolean } = {}
): Promise<{ status: "cancelled" }> {
  if (!Number.isInteger(input.bookingId)) throw new FlowkoBusinessError("forbidden");
  const { access } = await requireBookingAccess(db, actorUserId, input.bookingId, "act");
  const ref = await requireBusinessBooking(db, input.bookingId);
  if (ref.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  const actor = await resolveActor(db, access, input.actorMemberId);
  const reason = cancellationReason(input.reason);

  await withFlowkoTx(db, (tx) =>
    cancelInTx(tx, ref, { endTime: { gt: now } }, reason, {
      actorMemberId: actor.memberId,
      actorName: actor.name,
      userId: actorUserId,
    })
  );
  if (deps.sendMails !== false) await sendMailAfterCommit("cancelled", ref.bookingId);
  return { status: "cancelled" };
}

/** The customer's name as the action log's actor: the booking form's name, else the first attendee's. */
async function customerName(db: FlowkoDb, bookingId: number): Promise<string> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { responses: true, attendees: { select: { name: true }, orderBy: { id: "asc" }, take: 1 } },
  });
  const responses = booking?.responses;
  const name =
    typeof responses === "object" && responses !== null && !Array.isArray(responses)
      ? (responses as Record<string, unknown>).name
      : undefined;
  if (typeof name === "string" && name.trim() !== "") return name.trim();
  return booking?.attendees[0]?.name ?? "";
}

/**
 * W8: the cancel link in the customer's mail. A signed-in user who may act on the booking → the staff cancel
 * (W7) with their own member as actor; a signed-in ACTIVE member of the booking's business without that right →
 * forbidden (a worker never cancels a colleague's booking through the link); anyone else is the customer: the
 * same writes with actor = the customer (no member, the form's name, the session user if any), allowed until the
 * start (D4), else booking_not_active. A uid that is no business booking → not_business_booking.
 */
export async function cancelBusinessBookingAsCustomer(
  db: FlowkoDb,
  input: CustomerCancelInput,
  now: Date,
  deps: { sendMails?: boolean } = {}
): Promise<{ status: "cancelled" }> {
  const ref = typeof input.uid === "string" ? await businessBookingByUid(db, input.uid) : null;
  if (!ref) throw new FlowkoBusinessError("not_business_booking");

  const { sessionUserId } = input;
  if (sessionUserId !== null) {
    const access = await getBusinessAccess(db, sessionUserId);
    if (access && access.businessId === ref.businessId) {
      // The staff cancel checks act access first: forbidden for a member without it (no customer fallback).
      return cancelBusinessBooking(
        db,
        sessionUserId,
        { bookingId: ref.bookingId, reason: input.reason },
        now,
        deps
      );
    }
  }

  const reason = cancellationReason(input.reason);
  const actorName = await customerName(db, ref.bookingId);
  await withFlowkoTx(db, (tx) =>
    cancelInTx(tx, ref, { startTime: { gt: now } }, reason, {
      actorMemberId: null,
      actorName,
      userId: sessionUserId,
    })
  );
  if (deps.sendMails !== false) await sendMailAfterCommit("cancelled", ref.bookingId);
  return { status: "cancelled" };
}

type StepRow = {
  index: number;
  kind: "busy" | "processing";
  startTime: Date;
  endTime: Date;
  serviceId: number | null;
  serviceName: string;
};

/** The booking's own step copy as engine steps (serviceRef = the row's index), in index order. */
function stepsFromCopy(rows: StepRow[]): ServiceStep[] {
  return rows.map((row) => ({
    kind: row.kind,
    minutes: Math.round((row.endTime.getTime() - row.startTime.getTime()) / MINUTE_MS),
    serviceRef: String(row.index),
  }));
}

/**
 * The booking's status, start and step copy (index order); the move reads it again under the lock. Flowko U28:
 * a booking that has ended (endTime ≤ now) is booking_not_active (R6), checked again under the lock.
 */
async function readMovable(db: FlowkoDb, bookingId: number, now: Date) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      status: true,
      startTime: true,
      endTime: true, // Flowko U28
      flowkoBookingSteps: {
        select: {
          index: true,
          kind: true,
          startTime: true,
          endTime: true,
          serviceId: true,
          serviceName: true,
        },
        orderBy: { index: "asc" },
      },
    },
  });
  if (!booking || booking.status !== BookingStatus.ACCEPTED) {
    throw new FlowkoBusinessError("booking_not_active");
  }
  if (booking.endTime.getTime() <= now.getTime()) throw new FlowkoBusinessError("booking_not_active");
  // Every business booking is written with its step copy (W1).
  if (booking.flowkoBookingSteps.length === 0) throw new Error("Flowko U27: business booking without steps");
  return { fromStart: booking.startTime, rows: booking.flowkoBookingSteps };
}

type MoveTarget = {
  ref: BusinessBookingRef;
  workerUserId: number;
  start: number;
  date: string;
  dayEnd: number;
  googleBusy: Interval[];
  googleUnavailable: boolean; // Flowko U28: R7
  actor: { memberId: number; name: string };
};

async function moveInTx(
  tx: Tx,
  actorUserId: number,
  target: MoveTarget,
  confirmOverride: boolean,
  now: Date,
  lockWorker: NonNullable<WriterDeps["lockWorker"]>
): Promise<void> {
  const { ref, workerUserId } = target;
  await lockWorker(tx, workerUserId);

  // Read again under the lock: a concurrent move or cancel of this booking has committed by now, so fromStart
  // and the step copy are the ones this move replaces.
  const { fromStart, rows } = await readMovable(tx, ref.bookingId, now);
  const steps = stepsFromCopy(rows);
  const end = target.start + totalMinutes(steps) * MINUTE_MS;
  if (end > target.dayEnd) throw new FlowkoBusinessError("bad_booking");

  // W3 under the lock, the booking itself left out.
  const problems = await fitUnderLock(tx, {
    businessId: ref.businessId,
    date: target.date,
    memberId: ref.memberId,
    userId: workerUserId,
    steps,
    start: target.start,
    googleBusy: target.googleBusy,
    googleUnavailable: target.googleUnavailable,
    now,
    exceptBookingId: ref.bookingId,
    confirmOverride,
  });

  const startTime = new Date(target.start);
  const endTime = new Date(end);
  // Guarded on ACCEPTED: a cancel that won the race leaves nothing to move.
  const { count } = await tx.booking.updateMany({
    where: { id: ref.bookingId, status: BookingStatus.ACCEPTED },
    data: {
      startTime,
      endTime,
      idempotencyKey: IdempotencyKeyService.generate({ startTime, endTime, userId: workerUserId }),
      iCalSequence: { increment: 1 },
    },
  });
  if (count !== 1) throw new FlowkoBusinessError("booking_not_active");

  const byIndex = new Map(rows.map((row) => [String(row.index), row]));
  await tx.flowkoBookingStep.deleteMany({ where: { bookingId: ref.bookingId } });
  await tx.flowkoBookingStep.createMany({
    data: placeSteps(target.start, steps).map((placed) => {
      const row = placed.serviceRef === undefined ? undefined : byIndex.get(placed.serviceRef);
      if (!row) throw new Error("Flowko U27: moved step without its row");
      return {
        bookingId: ref.bookingId,
        index: row.index,
        kind: placed.kind,
        startTime: new Date(placed.start),
        endTime: new Date(placed.end),
        serviceId: row.serviceId,
        serviceName: row.serviceName,
      };
    }),
  });
  // U22: claims of the old time go; the new time gets its own reminder (the 60-minute gap still applies).
  await tx.flowkoAttendeeReminder.deleteMany({ where: { bookingId: ref.bookingId } });

  const overrides = problemKinds(problems);
  await tx.flowkoBookingAction.create({
    data: {
      bookingId: ref.bookingId,
      businessId: ref.businessId,
      action: FlowkoBookingActionKind.RESCHEDULED,
      actorMemberId: target.actor.memberId,
      actorName: target.actor.name,
      userId: actorUserId,
      details: {
        fromStart: fromStart.toISOString(),
        toStart: startTime.toISOString(),
        ...(overrides.length > 0 && { overrides }),
      },
    },
  });
}

/**
 * W9: move a business booking to a new start, same worker, same services (its own step copy, re-placed). Order:
 * act access → business booking → the worker (Ruling 1: role rule, LOCKED → worker_locked) → actor (W6) →
 * ACCEPTED only (else booking_not_active; Flowko U28: also once it has ended) → the new business-local day
 * (crossing midnight or an invalid start is bad_booking; Flowko U28: a new start before `now` on the grid is
 * in_past, never overridable) → Google busy, outside the transaction → transaction: worker lock → fit without
 * the booking → needs_confirm (nothing written) or the in-place writes. rescheduled, fromReschedule and
 * rescheduledBy stay untouched. A unique violation of the idempotency key (another booking of the worker at
 * exactly these times) is duplicate_time. Mails after the commit unless `deps.sendMails === false`.
 */
export async function moveBusinessBooking(
  db: FlowkoDb,
  actorUserId: number,
  input: MoveBookingInput,
  now: Date,
  deps: WriterDeps = {}
): Promise<WriteResult<"moved">> {
  if (!Number.isInteger(input.bookingId)) throw new FlowkoBusinessError("forbidden");
  const { access, booking: owned } = await requireBookingAccess(db, actorUserId, input.bookingId, "act");
  const ref = await requireBusinessBooking(db, input.bookingId);
  if (ref.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  const worker = await loadBookableWorker(db, access, ref.memberId);
  if (worker.userId !== owned.userId) throw new Error("Flowko U27: mirror worker is not the organizer");
  const actor = await resolveActor(db, access, input.actorMemberId);

  // Early refusals and the visit's length; the transaction reads the booking again under the lock.
  const { rows } = await readMovable(db, ref.bookingId, now);
  const business = await db.flowkoBusiness.findUnique({
    where: { id: ref.businessId },
    select: { timeZone: true, slotGridMinutes: true },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  const placed = await placeVisitDay(
    business.timeZone,
    input.start,
    totalMinutes(stepsFromCopy(rows)),
    worker.userId,
    { now, slotStepMinutes: business.slotGridMinutes },
    deps.googleBusy
  );

  const target: MoveTarget = {
    ref,
    workerUserId: worker.userId,
    start: placed.start,
    date: placed.date,
    dayEnd: placed.day.end,
    googleBusy: placed.googleBusy,
    googleUnavailable: placed.googleUnavailable,
    actor,
  };
  try {
    await withFlowkoTx(db, (tx) =>
      moveInTx(tx, actorUserId, target, input.confirmOverride, now, deps.lockWorker ?? lockWorkerAdvisory)
    );
  } catch (error) {
    if (error instanceof NeedsConfirm) return needsConfirmResult(error);
    // Outside the transaction: on Postgres the failed update has aborted it.
    if (isIdempotencyKeyConflict(error)) throw new FlowkoBusinessError("duplicate_time");
    // Flowko U29b: a service removed between the step copy's read and its re-insert (D1 e).
    if (isServiceForeignKeyRace(error)) throw new FlowkoBusinessError("service_not_assigned");
    throw error;
  }

  if (deps.sendMails !== false) await sendMailAfterCommit("moved", ref.bookingId);
  return { status: "moved", bookingId: ref.bookingId, uid: ref.uid };
}
