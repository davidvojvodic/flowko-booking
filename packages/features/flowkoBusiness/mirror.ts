// Flowko U27: the worker mirror. Every column worker of a business gets ONE hidden "mirror" EventType owned by the
// worker, bound to an explicit EMPTY Cal Schedule of the worker (M2, M4). Cal's slot engine therefore never offers
// the worker on a mirror, while Cal's mails, reminders and booking lists still work for the bookings the business
// writes on it. A business booking is exactly a booking whose event type is a mirror (M6). Written with plain
// eventType / schedule creates (never Cal's create handler); a mirror never sets teamId, parentId, profileId,
// hosts or a profile connect (Teams guard P2/P5). Server only.
// Flowko U29a (S4): a new mirror takes the business's current name and reminder choice under a FOR SHARE row
// lock, and updateBusinessMirrors carries a rename or a new reminder choice to every mirror of the business.
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
/**
 * M2: the reminder the customer gets one day ahead (U22 sweep reads metadata.flowkoReminders).
 * Flowko U29a (S1, S4): the fallback for a business without a stored list, and the offsets kept (switched off)
 * when the business chose no reminder, so the stored value stays valid for flowkoRemindersSchema (1–2 offsets).
 */
const MIRROR_REMINDER_OFFSETS_MINUTES: readonly number[] = [1440];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Flowko U29a (S4): a mirror's metadata.flowkoReminders for the business's reminder choice ([] = off).
 * A null list (prismock ignores list defaults; Postgres never stores NULL, CHECK) is the 24-hour default.
 */
export function mirrorReminders(reminderOffsets: readonly number[] | null | undefined): {
  enabled: boolean;
  offsets: number[];
} {
  const offsets = reminderOffsets ?? MIRROR_REMINDER_OFFSETS_MINUTES;
  return offsets.length > 0
    ? { enabled: true, offsets: Array.from(offsets) }
    : { enabled: false, offsets: Array.from(MIRROR_REMINDER_OFFSETS_MINUTES) };
}

type MirrorBusiness = { name: string; timeZone: string; reminderOffsets: number[] | null };

/**
 * Flowko U29a (S4): the business's name, time zone and reminder choice under a FOR SHARE row lock. A settings save
 * holds the row FOR UPDATE, so a first booking racing it waits and then reads the committed values; a save that
 * starts later waits for this transaction and then finds the new mirror. On Postgres the row always exists (the
 * member's foreign key); prismock answers every $queryRaw with [], so the plain read below runs only in tests.
 */
async function businessForNewMirror(tx: Tx, businessId: number): Promise<MirrorBusiness> {
  const rows = await tx.$queryRaw<MirrorBusiness[]>`
    SELECT "name", "timeZone", "reminderOffsets" FROM "FlowkoBusiness" WHERE "id" = ${businessId} FOR SHARE`;
  const business =
    rows[0] ??
    (await tx.flowkoBusiness.findUnique({
      where: { id: businessId },
      select: { name: true, timeZone: true, reminderOffsets: true },
    }));
  if (!business) throw new FlowkoBusinessError("bad_member");
  return business;
}

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
    },
  });
  if (!member || member.role === FlowkoBusinessRole.STAFF || member.userId === null) {
    throw new FlowkoBusinessError("bad_member");
  }

  const existing = await tx.flowkoWorkerMirror.findUnique({ where: { memberId }, select: mirrorSelect });
  if (existing) return existing;

  const userId = member.userId;
  // Flowko U29a (S4): current values, read under the business row lock (create path only, once per worker).
  const business = await businessForNewMirror(tx, member.businessId);
  await keepUsualDefaultSchedule(tx, userId);

  // M4: zero Availability rows. Its userId equals the event type's userId, so Cal keeps it as the event type's
  // schedule (eventTypeRepository scheduleOfOwnerOrHost) instead of falling back to the user's default.
  const schedule = await tx.schedule.create({
    data: {
      user: { connect: { id: userId } },
      name: MIRROR_SCHEDULE_NAME,
      timeZone: business.timeZone,
    },
    select: { id: true },
  });

  const eventType = await tx.eventType.create({
    data: {
      title: business.name,
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
        flowkoReminders: mirrorReminders(business.reminderOffsets),
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

/**
 * Flowko U29a (S4): carries a rename (`title`) and a new reminder choice (`reminderOffsets`, [] = off) to every
 * mirror of the business. Runs inside the settings save's transaction, after it locked the business row. Plain
 * event type writes by mirror id (no Cal route): the title in one updateMany; the reminders per mirror, merged
 * into its stored metadata without a schema parse, so no other key is stripped (the U22 sweep reads only
 * flowkoReminders). A field left out is not touched; reminders already claimed are not recalled.
 */
export async function updateBusinessMirrors(
  tx: Tx,
  businessId: number,
  change: { title?: string; reminderOffsets?: readonly number[] }
): Promise<void> {
  if (change.title === undefined && change.reminderOffsets === undefined) return;
  const mirrors = await tx.flowkoWorkerMirror.findMany({
    where: { businessId },
    select: { eventTypeId: true },
    orderBy: { eventTypeId: "asc" },
  });
  if (mirrors.length === 0) return;
  const ids = mirrors.map((m) => m.eventTypeId);

  if (change.title !== undefined) {
    await tx.eventType.updateMany({ where: { id: { in: ids } }, data: { title: change.title } });
  }
  if (change.reminderOffsets !== undefined) {
    const flowkoReminders = mirrorReminders(change.reminderOffsets);
    for (const id of ids) {
      const eventType = await tx.eventType.findUnique({ where: { id }, select: { metadata: true } });
      if (!eventType) continue;
      const metadata = isRecord(eventType.metadata) ? eventType.metadata : {};
      await tx.eventType.update({
        where: { id },
        data: { metadata: { ...metadata, flowkoMirror: true, flowkoReminders } },
      });
    }
  }
}

/** The mirror whose event type this is, or null (not a mirror, or no event type). */
export async function mirrorOfEventType(
  db: FlowkoDb,
  eventTypeId: number | null | undefined
): Promise<WorkerMirror | null> {
  if (eventTypeId === null || eventTypeId === undefined) return null;
  return db.flowkoWorkerMirror.findUnique({ where: { eventTypeId }, select: mirrorSelect });
}

/** The mirror bound to this schedule (a mirror's schedule is its own and unique), or null. */
export async function mirrorOfSchedule(db: FlowkoDb, scheduleId: number): Promise<WorkerMirror | null> {
  return db.flowkoWorkerMirror.findUnique({ where: { scheduleId }, select: mirrorSelect });
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
