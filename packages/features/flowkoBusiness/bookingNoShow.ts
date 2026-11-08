// Flowko U28: the logged no-show of a business booking (D4). The desk marks (or undoes) that the customer did not
// come: Attendee.noShow on the booking's attendees (one customer) and a NO_SHOW action with details { noShow },
// both in one transaction. Rights = act on the booking (U25; a WORKER only on her own, OWNER and STAFF on anyone's,
// a LOCKED worker's booking included, as cancel); only an ACCEPTED business booking that has started (startTime ≤
// the raw `now`, the same comparison as the desk's mayNoShow flag). No mail, no webhook. Nothing here loads a user
// with a top-level user query (the excludeLockedUsers extension would hide a locked worker). Server only.
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBookingActionKind } from "@calcom/prisma/enums";
import { requireBookingAccess } from "./access";
import { type ActorRef, resolveActor } from "./bookingWriter";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError } from "./errors";
import { businessBookingById } from "./mirror";

type Tx = Prisma.TransactionClient;

export type NoShowInput = ActorRef & { bookingId: number; noShow: boolean };

type NoShowWrite = {
  bookingId: number;
  businessId: number;
  noShow: boolean;
  actor: { memberId: number; name: string };
  actorUserId: number;
};

async function noShowInTx(tx: Tx, write: NoShowWrite, now: Date): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: write.bookingId },
    select: { status: true, startTime: true },
  });
  if (!booking || booking.status !== BookingStatus.ACCEPTED)
    throw new FlowkoBusinessError("booking_not_active");
  if (booking.startTime.getTime() > now.getTime()) throw new FlowkoBusinessError("booking_not_started");
  // Guarded write on the booking row (it only bumps updatedAt): it takes the row lock a concurrent cancel also
  // takes, so a cancel that committed first leaves nothing to mark (booking_not_active), never a CANCELLED
  // booking marked as no-show.
  const { count } = await tx.booking.updateMany({
    where: { id: write.bookingId, status: BookingStatus.ACCEPTED, startTime: { lte: now } },
    data: { updatedAt: new Date() },
  });
  if (count !== 1) throw new FlowkoBusinessError("booking_not_active");

  await tx.attendee.updateMany({ where: { bookingId: write.bookingId }, data: { noShow: write.noShow } });
  await tx.flowkoBookingAction.create({
    data: {
      bookingId: write.bookingId,
      businessId: write.businessId,
      action: FlowkoBookingActionKind.NO_SHOW,
      actorMemberId: write.actor.memberId,
      actorName: write.actor.name,
      userId: write.actorUserId,
      details: { noShow: write.noShow },
    },
  });
}

/**
 * D4: marks (`noShow` true) or undoes (false) the customer's no-show. Order: a non-integer id → forbidden; a
 * non-boolean flag → bad_booking; act access (missing = foreign = forbidden) → business booking (else
 * not_business_booking) → actor (W6, U28 R9) → transaction: ACCEPTED (else booking_not_active), started (else
 * booking_not_started), the attendee flag and the NO_SHOW action.
 */
export async function setBusinessNoShow(
  db: FlowkoDb,
  actorUserId: number,
  input: NoShowInput,
  now: Date
): Promise<{ status: "updated"; noShow: boolean }> {
  if (!Number.isInteger(input.bookingId)) throw new FlowkoBusinessError("forbidden");
  if (typeof input.noShow !== "boolean") throw new FlowkoBusinessError("bad_booking");
  const { access } = await requireBookingAccess(db, actorUserId, input.bookingId, "act");
  const ref = await businessBookingById(db, input.bookingId);
  if (!ref) throw new FlowkoBusinessError("not_business_booking");
  if (ref.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  const actor = await resolveActor(db, access, input.actorMemberId);

  await withFlowkoTx(db, (tx) =>
    noShowInTx(
      tx,
      { bookingId: ref.bookingId, businessId: ref.businessId, noShow: input.noShow, actor, actorUserId },
      now
    )
  );
  return { status: "updated", noShow: input.noShow };
}
