// Flowko U27: the worker mirror. Every column worker of a business gets ONE hidden "mirror" EventType owned by the
// worker, bound to an explicit EMPTY Cal Schedule of the worker (M2, M4). Cal's slot engine therefore never offers
// the worker on a mirror, while Cal's mails, reminders and booking lists still work for the bookings the business
// writes on it. A business booking is exactly a booking whose event type is a mirror (M6). Written with plain
// eventType / schedule creates (never Cal's create handler); a mirror never sets teamId, parentId, profileId,
// hosts or a profile connect (Teams guard P2/P5). Server only.
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";

type Tx = Prisma.TransactionClient;

/** M2: the mirror event type's length; the business writer sets each booking's own end time. */
const MIRROR_LENGTH_MINUTES = 30;
/** M4: the name of the worker's empty schedule. */
const MIRROR_SCHEDULE_NAME = "Flowko termini";
/** M2: Cal's event-name template; renders the title (= business name) instead of "<title> between A and B". */
const MIRROR_EVENT_NAME = "{Event type title}";
/** M2: the reminder the customer gets one day ahead (U22 sweep reads metadata.flowkoReminders). */
const MIRROR_REMINDER_OFFSETS_MINUTES = [1440];

const mirrorSelect = {
  eventTypeId: true,
  scheduleId: true,
  businessId: true,
  memberId: true,
} satisfies Prisma.FlowkoWorkerMirrorSelect;

function mirrorSlug(memberId: number): string {
  return `flowko-termin-${memberId}`;
}

/**
 * M5: Cal falls back to a user's first schedule when defaultScheduleId is NULL, which could become the empty
 * mirror schedule. Before the mirror schedule exists: a user without a default who has another schedule gets
 * the lowest-id one as default; anyone else is left as is. The read opts out of Cal's excludeLockedUsers
 * extension (a locked worker's user is found too).
 */
async function keepUsualDefaultSchedule(tx: Tx, userId: number): Promise<void> {
  const user = await tx.user.findFirst({
    where: { id: userId, OR: [{ locked: false }, { locked: true }] },
    select: { defaultScheduleId: true },
  });
  if (!user || user.defaultScheduleId !== null) return;
  const lowest = await tx.schedule.findFirst({
    where: { userId },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!lowest) return;
  await tx.user.update({ where: { id: userId }, data: { defaultScheduleId: lowest.id } });
}

async function businessBookingOf(
  db: FlowkoDb,
  booking: { id: number; uid: string; eventTypeId: number | null } | null
): Promise<BusinessBookingRef | null> {
  if (!booking || booking.eventTypeId === null) return null;
  const mirror = await db.flowkoWorkerMirror.findUnique({
    where: { eventTypeId: booking.eventTypeId },
    select: { ...mirrorSelect, business: { select: { slug: true } } },
  });
  if (!mirror) return null;
  return {
    bookingId: booking.id,
    uid: booking.uid,
    businessId: mirror.businessId,
    businessSlug: mirror.business.slug,
    memberId: mirror.memberId,
    eventTypeId: mirror.eventTypeId,
  };
}

const bookingRefSelect = { id: true, uid: true, eventTypeId: true } satisfies Prisma.BookingSelect;

export type WorkerMirror = { eventTypeId: number; scheduleId: number; businessId: number; memberId: number };

export type BusinessBookingRef = {
  bookingId: number;
  uid: string;
  businessId: number;
  businessSlug: string;
  memberId: number;
  eventTypeId: number;
};

/**
 * The member's mirror, created on first use (idempotent). Refuses (bad_member) a missing member, a STAFF member
 * and a member without a login user (no calendar column). Takes the caller's transaction: the booking writer
 * calls it inside the booking transaction. Two concurrent first calls for one member end in a unique-key
 * violation of the second (FlowkoWorkerMirror.memberId, EventType userId+slug), never in two mirrors.
 */
export async function ensureWorkerMirror(tx: Tx, memberId: number): Promise<WorkerMirror> {
  const member = await tx.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      role: true,
      userId: true,
      businessId: true,
      business: { select: { name: true, timeZone: true } },
    },
  });
  if (!member || member.role === FlowkoBusinessRole.STAFF || member.userId === null) {
    throw new FlowkoBusinessError("bad_member");
  }

  const existing = await tx.flowkoWorkerMirror.findUnique({ where: { memberId }, select: mirrorSelect });
  if (existing) return existing;

  const userId = member.userId;
  await keepUsualDefaultSchedule(tx, userId);

  // M4: zero Availability rows. Its userId equals the event type's userId, so Cal keeps it as the event type's
  // schedule (eventTypeRepository scheduleOfOwnerOrHost) instead of falling back to the user's default.
  const schedule = await tx.schedule.create({
    data: {
      user: { connect: { id: userId } },
      name: MIRROR_SCHEDULE_NAME,
      timeZone: member.business.timeZone,
    },
    select: { id: true },
  });

  const eventType = await tx.eventType.create({
    data: {
      title: member.business.name,
      slug: mirrorSlug(member.id),
      length: MIRROR_LENGTH_MINUTES,
      hidden: true,
      owner: { connect: { id: userId } },
      users: { connect: [{ id: userId }] },
      schedule: { connect: { id: schedule.id } },
      hideOrganizerEmail: true,
      customReplyToEmail: null,
      disableRescheduling: true,
      disableCancelling: false,
      disableGuests: true,
      eventName: MIRROR_EVENT_NAME,
      requiresConfirmation: false,
      locations: [],
      metadata: {
        flowkoMirror: true,
        flowkoReminders: { enabled: true, offsets: MIRROR_REMINDER_OFFSETS_MINUTES },
      },
    },
    select: { id: true },
  });

  return tx.flowkoWorkerMirror.create({
    data: {
      businessId: member.businessId,
      memberId: member.id,
      eventTypeId: eventType.id,
      scheduleId: schedule.id,
    },
    select: mirrorSelect,
  });
}

/** The mirror whose event type this is, or null (not a mirror, or no event type). */
export async function mirrorOfEventType(
  db: FlowkoDb,
  eventTypeId: number | null | undefined
): Promise<WorkerMirror | null> {
  if (eventTypeId === null || eventTypeId === undefined) return null;
  return db.flowkoWorkerMirror.findUnique({ where: { eventTypeId }, select: mirrorSelect });
}

/** M6: the booking with this uid when it is a business booking (its event type is a mirror), else null. */
export async function businessBookingByUid(db: FlowkoDb, uid: string): Promise<BusinessBookingRef | null> {
  const booking = await db.booking.findUnique({ where: { uid }, select: bookingRefSelect });
  return businessBookingOf(db, booking);
}

/** M6: the booking with this id when it is a business booking (its event type is a mirror), else null. */
export async function businessBookingById(
  db: FlowkoDb,
  bookingId: number
): Promise<BusinessBookingRef | null> {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: bookingRefSelect });
  return businessBookingOf(db, booking);
}

/** The mirror event type and schedule ids owned by this user (none, or one of each). */
export async function mirrorIdsOfUser(
  db: FlowkoDb,
  userId: number
): Promise<{ eventTypeIds: number[]; scheduleIds: number[] }> {
  const member = await db.flowkoBusinessMember.findUnique({ where: { userId }, select: { id: true } });
  if (!member) return { eventTypeIds: [], scheduleIds: [] };
  const mirror = await db.flowkoWorkerMirror.findUnique({
    where: { memberId: member.id },
    select: { eventTypeId: true, scheduleId: true },
  });
  if (!mirror) return { eventTypeIds: [], scheduleIds: [] };
  return { eventTypeIds: [mirror.eventTypeId], scheduleIds: [mirror.scheduleId] };
}

/**
 * D2: the user's role and business slug when they are a WORKER or STAFF member of a business, in any status
 * (a LOCKED member counts); null for an OWNER and for a user in no business. Cal screens and public pages use
 * it to decide what such a user may see.
 */
export async function nonOwnerMemberOf(
  db: FlowkoDb,
  userId: number
): Promise<{ role: "WORKER" | "STAFF"; businessSlug: string } | null> {
  const member = await db.flowkoBusinessMember.findUnique({
    where: { userId },
    select: { role: true, business: { select: { slug: true } } },
  });
  if (!member) return null;
  if (member.role === FlowkoBusinessRole.WORKER)
    return { role: "WORKER", businessSlug: member.business.slug };
  if (member.role === FlowkoBusinessRole.STAFF) return { role: "STAFF", businessSlug: member.business.slug };
  return null;
}
