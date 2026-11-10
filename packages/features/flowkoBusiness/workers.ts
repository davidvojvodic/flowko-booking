// Flowko U29c: the owner's „Delavci“ list (W1): every member of the business with status, role and flags, the
// number of future business bookings of each column member, and, for a LOCKED column member only, the bookings
// themselves so the owner can hand them over. Privacy (C12): the bookings come only from the member's mirror
// event type (the business's own bookings, never a worker's private Cal bookings), only holding ones that are
// not over, and carry id, local date and time, service names and the first attendee's name; no uid, e-mail,
// phone or user id is selected or returned, and the member's user id stays inside this function (isMe and
// noLogin are computed here). Also the owner's member writes: add a desk-only worker (W4) and reorder every
// member (W5), both under the business row lock. Owner only. Server only.
import { formatHm } from "@calcom/lib/flowkoBusiness/desk";
import { todayIn } from "@calcom/lib/flowkoBusiness/roster";
import {
  WORKER_BOOKINGS_SHOWN,
  type WorkerListBooking,
  type WorkerListRow,
} from "@calcom/lib/flowkoBusiness/workers";
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoMemberStatus } from "@calcom/prisma/enums";
import { listMembers, mayManageBusiness, requireBusinessAccess } from "./access";
import { HOLDING_STATUSES } from "./bookingDay";
import { createDeskOnlyWorker, displayNameOrThrow } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { memberTx } from "./memberTx";

/** The mirror's bookings that still hold the member's time: holding status and not over (`endTime > now`). */
function futureWhere(eventTypeIds: number[], now: Date) {
  return { eventTypeId: { in: eventTypeIds }, status: { in: HOLDING_STATUSES }, endTime: { gt: now } };
}

/**
 * Every member of the owner's business in position order. `futureCount` counts the member's future business
 * bookings (0 for STAFF and for a member without a mirror yet); `futureBookings` lists them (at most
 * WORKER_BOOKINGS_SHOWN, earliest first) for a LOCKED column member only, `moreBookings` the rest. Owner only;
 * anyone else is `forbidden`.
 */
export async function listWorkers(
  db: FlowkoDb,
  actorUserId: number,
  now: Date
): Promise<{ members: WorkerListRow[] }> {
  const access = await requireBusinessAccess(db, actorUserId);
  if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");

  const business = await db.flowkoBusiness.findUnique({
    where: { id: access.businessId },
    select: { timeZone: true },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  const timeZone = business.timeZone;

  const members = await listMembers(db, access.businessId);
  const columnIds = new Set(members.filter((m) => m.hasColumn).map((m) => m.memberId));
  const mirrors = await db.flowkoWorkerMirror.findMany({
    where: { businessId: access.businessId },
    select: { eventTypeId: true, memberId: true },
  });
  const eventTypeOf = new Map<number, number>(); // memberId -> mirror event type
  const memberOf = new Map<number, number>(); // mirror event type -> memberId
  for (const mirror of mirrors) {
    if (!columnIds.has(mirror.memberId)) continue;
    eventTypeOf.set(mirror.memberId, mirror.eventTypeId);
    memberOf.set(mirror.eventTypeId, mirror.memberId);
  }

  // Counts: one query for every column member, counted in code (no relations loaded).
  const counts = new Map<number, number>();
  if (memberOf.size > 0) {
    const rows = await db.booking.findMany({
      where: futureWhere(Array.from(memberOf.keys()), now),
      select: { eventTypeId: true },
    });
    for (const row of rows) {
      const memberId = row.eventTypeId === null ? undefined : memberOf.get(row.eventTypeId);
      if (memberId !== undefined) counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
    }
  }

  const rows: WorkerListRow[] = [];
  for (const member of members) {
    const futureCount = counts.get(member.memberId) ?? 0;
    const eventTypeId = eventTypeOf.get(member.memberId);
    let futureBookings: WorkerListBooking[] = [];
    if (member.status === FlowkoMemberStatus.LOCKED && eventTypeId !== undefined && futureCount > 0) {
      // Details for this LOCKED member only, as the desk joins them (desk.ts): first attendee, steps in order.
      const found = await db.booking.findMany({
        where: futureWhere([eventTypeId], now),
        select: {
          id: true,
          startTime: true,
          endTime: true,
          attendees: { select: { name: true }, orderBy: { id: "asc" } },
          flowkoBookingSteps: { select: { serviceName: true }, orderBy: { index: "asc" } },
        },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        take: WORKER_BOOKINGS_SHOWN,
      });
      futureBookings = found.map((booking) => ({
        bookingId: booking.id,
        date: todayIn(timeZone, booking.startTime),
        from: formatHm(booking.startTime.getTime(), timeZone),
        to: formatHm(booking.endTime.getTime(), timeZone),
        services: Array.from(new Set(booking.flowkoBookingSteps.map((s) => s.serviceName))),
        customerName: booking.attendees[0]?.name ?? "",
      }));
    }
    rows.push({
      memberId: member.memberId,
      displayName: member.displayName,
      role: member.role,
      status: member.status,
      noLogin: member.deskOnly || member.userId === null,
      isMe: member.userId === actorUserId,
      futureCount,
      futureBookings,
      // Only a listed (LOCKED) row has a "rest"; an ACTIVE row shows its count and no list.
      // The two reads are separate queries, so a booking made between them could make the list longer than the count.
      moreBookings:
        member.status === FlowkoMemberStatus.LOCKED ? Math.max(0, futureCount - futureBookings.length) : 0,
    });
  }
  return { members: rows };
}

/**
 * Flowko U29c: the business row lock every member add and reorder takes first (re-taking it in one tx is a no-op).
 * FOR NO KEY UPDATE: still serialises the creators, but a booking's FOR KEY SHARE FK check does not wait behind it.
 */
async function lockBusiness(tx: Prisma.TransactionClient, businessId: number): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "FlowkoBusiness" WHERE "id" = ${businessId} FOR NO KEY UPDATE`;
}

/** Flowko U29c: one comparison key per name: trimmed, Unicode-composed (NFC), lower-cased by Slovene rules. */
const nameKey = (name: string): string => name.trim().normalize("NFC").toLocaleLowerCase("sl");

/**
 * W4: adds a desk-only worker (ACTIVE WORKER with a desk column at once, no usual week, no services) as the last
 * member. Owner only (otherwise forbidden); the name is trimmed, 1..80 characters (bad_member) and unique in the
 * business without regard to case, over every member of any status or kind (member_name_taken). Under the business
 * row lock, so two adds never get the same position or the same name. A lost lock race is member_conflict.
 */
export async function addDeskWorker(
  db: FlowkoDb,
  actorUserId: number,
  input: { displayName: string }
): Promise<{ memberId: number }> {
  return memberTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
    const name = displayNameOrThrow(input.displayName);

    await lockBusiness(tx, access.businessId);
    const members = await tx.flowkoBusinessMember.findMany({
      where: { businessId: access.businessId },
      select: { displayName: true },
    });
    const key = nameKey(name);
    if (members.some((m) => nameKey(m.displayName) === key))
      throw new FlowkoBusinessError("member_name_taken");

    const { memberId } = await createDeskOnlyWorker(tx, access.businessId, name);
    return { memberId };
  });
}

/**
 * W5: stores the owner's order: `position = index` over `memberIds`, which must be exactly the business's members
 * (OWNER, STAFF, LOCKED and desk-only included): a missing, extra, duplicate or foreign id is bad_member and nothing
 * is written. Owner only (otherwise forbidden). Under the business row lock; a lost lock race is member_conflict.
 */
export async function reorderWorkers(
  db: FlowkoDb,
  actorUserId: number,
  input: { memberIds: number[] }
): Promise<{ status: "saved" }> {
  return memberTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
    if (!input.memberIds.every((id) => Number.isInteger(id))) throw new FlowkoBusinessError("bad_member");

    await lockBusiness(tx, access.businessId);
    const stored = await tx.flowkoBusinessMember.findMany({
      where: { businessId: access.businessId },
      select: { id: true },
    });
    const storedIds = new Set(stored.map((m) => m.id));
    const sent = new Set(input.memberIds);
    if (
      input.memberIds.length !== stored.length ||
      sent.size !== input.memberIds.length ||
      !input.memberIds.every((id) => storedIds.has(id))
    )
      throw new FlowkoBusinessError("bad_member");

    // Flowko U29c: an indexed loop, not `entries()` (the trpc build targets ES5 without downlevelIteration).
    for (let position = 0; position < input.memberIds.length; position++) {
      await tx.flowkoBusinessMember.update({ where: { id: input.memberIds[position] }, data: { position } });
    }
    return { status: "saved" as const };
  });
}
