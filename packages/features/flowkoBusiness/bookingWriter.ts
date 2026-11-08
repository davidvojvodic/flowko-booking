// Flowko U27: the business booking writer (create). Staff of a business write a stepped visit straight into a
// worker's column: one ordinary Cal Booking on the worker's hidden mirror event type (W1), its per-booking step
// copy and a CREATED action-log row, all in one transaction that first takes the worker's advisory lock (W2) and
// re-runs the U24 fit (W3). Problems come back as needs_confirm with nothing written unless the desk confirms the
// override; the who-acted member (W6) is a label, never a right. Cal's mails go out after the commit
// (bookingMail.ts, through sendMailAfterCommit, which never throws). Prismock tests inject the lock; the lock, the
// idempotency key and the rollback are proven on Postgres (bookingWriter.integration-test.ts). The cancel and move
// writers (bookingChange.ts) reuse the worker rule, the sentinel and the mail helper. Server only.
import getICalUID from "@calcom/emails/lib/getICalUID";
import { getEventName } from "@calcom/features/eventtypes/lib/eventNaming";
import { getTranslation } from "@calcom/i18n/server";
import { todayIn } from "@calcom/lib/flowkoBusiness/roster";
import {
  dayBounds,
  explainFit,
  type FitProblem,
  type Interval,
  type PlacedStep,
  placeSteps,
  type ServiceStep,
  totalMinutes,
} from "@calcom/lib/flowkoSalon";
import logger from "@calcom/lib/logger";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBookingActionKind, FlowkoMemberStatus } from "@calcom/prisma/enums";
import short from "short-uuid";
import { type BusinessAccess, mayBookFor, requireBusinessAccess } from "./access";
import {
  combinedSteps,
  googleBusyFor,
  loadServicesForWorker,
  loadWorkerBookings,
  roundDownToGrid,
  type ServiceForBooking,
} from "./bookingDay";
import { type Customer, type CustomerInput, parseCustomer } from "./customer";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { loadBusinessDay } from "./roster";

type Tx = Prisma.TransactionClient;

const log = logger.getSubLogger({ prefix: ["flowko-business-booking-writer"] });

const MINUTE_MS = 60_000;
/** W2: the advisory-lock namespace of the booking writer; the second key is the worker's user id. */
const WORKER_LOCK_NAMESPACE = 27027;
/** W1: the customer's attendee locale (Slovene business). */
const ATTENDEE_LOCALE = "sl";
/** M3: the language of the stored title when the worker has none. */
const DEFAULT_TITLE_LOCALE = "sl";
/** The unique index Cal's idempotency extension fills on ACCEPTED bookings (D1). */
const IDEMPOTENCY_INDEX = "Booking_idempotencyKey_key";
const IDEMPOTENCY_COLUMN = "idempotencyKey";

export type ActorRef = { actorMemberId?: number | null };
export type CreateBookingInput = ActorRef & {
  workerMemberId: number;
  serviceIds: number[];
  start: Date;
  customer: CustomerInput;
  confirmOverride: boolean;
};
/** U24 FitProblem; intervals in epoch ms. */
export type FitProblemOut = FitProblem;
export type WriteResult<S extends string> =
  | { status: S; bookingId: number; uid: string }
  | { status: "needs_confirm"; problems: FitProblemOut[] };
export type WriterDeps = {
  lockWorker?: (tx: Prisma.TransactionClient, userId: number) => Promise<void>;
  googleBusy?: typeof googleBusyFor;
  sendMails?: boolean;
};

/** W2: the worker's transaction-scoped advisory lock; two desks writing one worker's day queue here. */
export async function lockWorkerAdvisory(tx: Tx, userId: number): Promise<void> {
  // $executeRaw, not $queryRaw: the function returns void, which the query path cannot deserialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WORKER_LOCK_NAMESPACE}::integer, ${userId}::integer)`;
}

/** D1: true for a unique violation of Booking.idempotencyKey, in the classic and in the driver-adapter form. */
export function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = (error.meta ?? {}) as {
    target?: unknown;
    driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
  };
  const names = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.replace(/"/g, ""));
  const constraint = meta.driverAdapterError?.cause?.constraint;
  const named = [...names(meta.target), ...names(constraint?.fields), ...names(constraint?.index)];
  return named.some((name) => name === IDEMPOTENCY_COLUMN || name === IDEMPOTENCY_INDEX);
}

export type BusinessMailKind = "created" | "moved" | "cancelled";

/**
 * Cal's mails of a committed business booking. Loading the mail module and sending both sit inside one
 * try/catch: a failure is logged (kind, booking id, error class) and never rejects the writer's call, whose
 * booking is already committed.
 */
export async function sendMailAfterCommit(kind: BusinessMailKind, bookingId: number): Promise<void> {
  try {
    const mail = await import("./bookingMail");
    const senders: Record<BusinessMailKind, (id: number) => Promise<void>> = {
      created: mail.sendBusinessBookingCreated,
      moved: mail.sendBusinessBookingMoved,
      cancelled: mail.sendBusinessBookingCancelled,
    };
    await senders[kind](bookingId);
  } catch (error) {
    log.error("business booking mail not sent", {
      kind,
      bookingId,
      errorClass: error instanceof Error ? error.name : typeof error,
    });
  }
}

/**
 * W6: who acted. `actorMemberId` = any ACTIVE member of the actor's business (staff without login and desk-only
 * workers included); missing = the actor's own member. Unknown, foreign or LOCKED ids are forbidden. A label for
 * the action log, never a right.
 */
export async function resolveActor(
  tx: FlowkoDb,
  access: BusinessAccess,
  actorMemberId?: number | null
): Promise<{ memberId: number; name: string }> {
  const id = actorMemberId ?? access.memberId;
  if (!Number.isInteger(id)) throw new FlowkoBusinessError("forbidden");
  const member = await tx.flowkoBusinessMember.findUnique({
    where: { id },
    select: { id: true, businessId: true, status: true, displayName: true },
  });
  if (!member || member.businessId !== access.businessId || member.status !== FlowkoMemberStatus.ACTIVE) {
    throw new FlowkoBusinessError("forbidden");
  }
  return { memberId: member.id, name: member.displayName };
}

export type BookableWorker = {
  memberId: number;
  userId: number;
  email: string;
  name: string;
  locale: string | null;
};

/**
 * Ruling 1: the target worker loaded from the database (missing = another business's = forbidden), then the
 * actor's role rule ignoring the worker's status (OWNER/STAFF any column member, WORKER only self; else
 * forbidden), then a LOCKED worker = worker_locked.
 */
export async function loadBookableWorker(
  db: FlowkoDb,
  access: BusinessAccess,
  memberId: number
): Promise<BookableWorker> {
  if (!Number.isInteger(memberId)) throw new FlowkoBusinessError("forbidden");
  const member = await db.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      businessId: true,
      role: true,
      status: true,
      displayName: true,
      userId: true,
      user: { select: { email: true, name: true, locale: true } },
    },
  });
  if (!member || member.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  const ref = { memberId: member.id, businessId: member.businessId, role: member.role };
  if (!mayBookFor(access, { ...ref, status: FlowkoMemberStatus.ACTIVE })) {
    throw new FlowkoBusinessError("forbidden");
  }
  if (member.status !== FlowkoMemberStatus.ACTIVE) throw new FlowkoBusinessError("worker_locked");
  // A column member always has a user (U25 CHECK).
  if (member.userId === null || !member.user) throw new Error("Flowko U27: column member without user");
  return {
    memberId: member.id,
    userId: member.userId,
    email: member.user.email,
    name: member.user.name?.trim() || member.displayName,
    locale: member.user.locale,
  };
}

/** M3: Cal's default title in the worker's language: „Barvanje + Moško striženje med Ana in Marija Novak“. */
async function bookingTitle(
  worker: BookableWorker,
  services: ServiceForBooking[],
  customer: Customer,
  minutes: number
) {
  return getEventName({
    eventType: services.map((s) => s.name).join(" + "),
    host: worker.name,
    attendeeName: customer.name,
    eventDuration: minutes,
    t: await getTranslation(worker.locale ?? DEFAULT_TITLE_LOCALE, "common"),
  });
}

/** Each problem kind once, in the engine's order. */
export function problemKinds(problems: FitProblem[]): string[] {
  return Array.from(new Set(problems.map((p) => p.kind)));
}

/** Thrown inside the transaction so a refused fit rolls back the lock-time writes (the lazy mirror). */
export class NeedsConfirm extends Error {
  constructor(readonly problems: FitProblem[]) {
    super("needs_confirm");
    this.name = "NeedsConfirm";
  }
}

/**
 * The business-local day of a visit of `minutes` starting at `start`, and the worker's Google busy time of that
 * day (fetched here, outside any transaction). An invalid start, or a visit ending after the local day ends
 * (crossing midnight), is bad_booking. Shared by create and move.
 */
export async function placeVisitDay(
  timeZone: string,
  start: Date,
  minutes: number,
  workerUserId: number,
  googleBusy?: WriterDeps["googleBusy"]
): Promise<{ start: number; end: number; date: string; day: Interval; googleBusy: Interval[] }> {
  const startMs = start instanceof Date ? start.getTime() : Number.NaN;
  if (!Number.isFinite(startMs)) throw new FlowkoBusinessError("bad_booking");
  const end = startMs + minutes * MINUTE_MS;
  const date = todayIn(timeZone, new Date(startMs));
  const day = dayBounds(date, timeZone);
  if (end > day.end) throw new FlowkoBusinessError("bad_booking");
  const google = await (googleBusy ?? googleBusyFor)(workerUserId, day);
  return { start: startMs, end, date, day, googleBusy: google.busy };
}

export type FitUnderLockInput = {
  businessId: number;
  date: string;
  memberId: number;
  userId: number;
  steps: ServiceStep[];
  start: number;
  googleBusy: Interval[];
  now: Date;
  /** A move leaves the booking itself out. */
  exceptBookingId?: number;
  confirmOverride: boolean;
};

/**
 * W3: the U24 fit, run inside the transaction after the worker's lock, on the worker's current bookings of the
 * day (notice 0, `now` on the business grid). A worker no longer in the day's columns (locked meanwhile) is
 * worker_locked; problems without `confirmOverride` throw NeedsConfirm (the caller's transaction rolls back).
 * Returns the problems the desk confirmed (empty when it fits). Shared by create and move.
 */
export async function fitUnderLock(tx: Tx, input: FitUnderLockInput): Promise<FitProblem[]> {
  const loaded = await loadBusinessDay(tx, input.businessId, input.date);
  const column = loaded.workers.find((w) => w.memberId === input.memberId);
  if (!column) throw new FlowkoBusinessError("worker_locked");
  const bookings = await loadWorkerBookings(tx, input.userId, loaded.rules.day, input.exceptBookingId);
  const problems = explainFit(
    { shifts: column.shifts, timeOff: column.timeOff, bookings, externalBusy: input.googleBusy },
    input.steps,
    input.start,
    {
      opening: loaded.rules.opening,
      slotStepMinutes: loaded.rules.slotStepMinutes,
      minimumNoticeMinutes: 0,
      now: roundDownToGrid(input.now, loaded.rules.day, loaded.rules.slotStepMinutes),
      day: loaded.rules.day,
    }
  );
  if (problems.length > 0 && !input.confirmOverride) throw new NeedsConfirm(problems);
  return problems;
}

type Visit = {
  worker: BookableWorker;
  actor: { memberId: number; name: string };
  customer: Customer;
  services: ServiceForBooking[];
  start: number;
  end: number;
  date: string;
  timeZone: string;
  location: string | null;
  title: string;
  googleBusy: Interval[];
};

function stepRows(bookingId: number, placed: PlacedStep[], services: ServiceForBooking[]) {
  const byRef = new Map(services.map((s) => [String(s.id), s]));
  return placed.map((p) => {
    const service = p.serviceRef === undefined ? undefined : byRef.get(p.serviceRef);
    if (!service) throw new Error("Flowko U27: step without its service");
    return {
      bookingId,
      index: p.index,
      kind: p.kind,
      startTime: new Date(p.start),
      endTime: new Date(p.end),
      serviceId: service.id,
      serviceName: service.name,
    };
  });
}

async function writeInTx(
  tx: Tx,
  businessId: number,
  actorUserId: number,
  visit: Visit,
  input: CreateBookingInput,
  now: Date,
  lockWorker: NonNullable<WriterDeps["lockWorker"]>
): Promise<{ bookingId: number; uid: string }> {
  const { worker } = visit;
  await lockWorker(tx, worker.userId);
  const mirror = await ensureWorkerMirror(tx, worker.memberId);

  const steps = combinedSteps(visit.services);
  const problems = await fitUnderLock(tx, {
    businessId,
    date: visit.date,
    memberId: worker.memberId,
    userId: worker.userId,
    steps,
    start: visit.start,
    googleBusy: visit.googleBusy,
    now,
    confirmOverride: input.confirmOverride,
  });

  // W1: Cal's booking, written directly (the U23 fields).
  const uid = short().generate();
  const { customer } = visit;
  const booking = await tx.booking.create({
    data: {
      uid,
      iCalUID: getICalUID({ uid }),
      iCalSequence: 0,
      title: visit.title,
      startTime: new Date(visit.start),
      endTime: new Date(visit.end),
      status: BookingStatus.ACCEPTED,
      userPrimaryEmail: worker.email,
      responses: {
        name: customer.name,
        ...(customer.email !== null && { email: customer.email }),
        ...(customer.phone !== null && { attendeePhoneNumber: customer.phone }),
      },
      location: visit.location,
      metadata: {},
      oneTimePassword: null,
      eventType: { connect: { id: mirror.eventTypeId } },
      // Never an unchecked userId: the idempotency extension reads only user.connect.id.
      user: { connect: { id: worker.userId } },
      attendees: {
        create: {
          name: customer.name,
          email: customer.attendeeEmail,
          timeZone: visit.timeZone,
          locale: ATTENDEE_LOCALE,
          phoneNumber: customer.phone,
        },
      },
    },
    select: { id: true, uid: true },
  });

  await tx.flowkoBookingStep.createMany({
    data: stepRows(booking.id, placeSteps(visit.start, steps), visit.services),
  });
  const overrides = problemKinds(problems);
  await tx.flowkoBookingAction.create({
    data: {
      bookingId: booking.id,
      businessId,
      action: FlowkoBookingActionKind.CREATED,
      actorMemberId: visit.actor.memberId,
      actorName: visit.actor.name,
      userId: actorUserId,
      ...(overrides.length > 0 && { details: { overrides } }),
    },
  });
  return { bookingId: booking.id, uid: booking.uid };
}

/**
 * Creates a business booking. Order: access → target worker (Ruling 1) → actor (W6) → customer (W4) → services
 * (W5) → the business-local day (a visit crossing midnight is bad_booking) → Google busy, outside the
 * transaction → transaction: worker lock → mirror → fit → needs_confirm (nothing written) or the writes. A
 * unique violation of the idempotency key (same worker, same start and end) is duplicate_time. Mails after the
 * commit unless `deps.sendMails === false`.
 */
export async function createBusinessBooking(
  db: FlowkoDb,
  actorUserId: number,
  input: CreateBookingInput,
  now: Date,
  deps: WriterDeps = {}
): Promise<WriteResult<"created">> {
  const access = await requireBusinessAccess(db, actorUserId);
  const worker = await loadBookableWorker(db, access, input.workerMemberId);
  const actor = await resolveActor(db, access, input.actorMemberId);
  const customer = parseCustomer(input.customer);
  const services = await loadServicesForWorker(db, access.businessId, worker.memberId, input.serviceIds);

  const business = await db.flowkoBusiness.findUnique({
    where: { id: access.businessId },
    select: { timeZone: true, address: true },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  const minutes = totalMinutes(combinedSteps(services));
  const placed = await placeVisitDay(business.timeZone, input.start, minutes, worker.userId, deps.googleBusy);
  const visit: Visit = {
    worker,
    actor,
    customer,
    services,
    start: placed.start,
    end: placed.end,
    date: placed.date,
    timeZone: business.timeZone,
    location: business.address ?? null,
    title: await bookingTitle(worker, services, customer, minutes),
    googleBusy: placed.googleBusy,
  };

  let written: { bookingId: number; uid: string };
  try {
    written = await withFlowkoTx(db, (tx) =>
      writeInTx(tx, access.businessId, actorUserId, visit, input, now, deps.lockWorker ?? lockWorkerAdvisory)
    );
  } catch (error) {
    if (error instanceof NeedsConfirm) return { status: "needs_confirm", problems: error.problems };
    // Caught here, outside the transaction: on Postgres the failed insert has aborted it.
    if (isIdempotencyKeyConflict(error)) throw new FlowkoBusinessError("duplicate_time");
    throw error;
  }

  if (deps.sendMails !== false) await sendMailAfterCommit("created", written.bookingId);
  return { status: "created", ...written };
}
