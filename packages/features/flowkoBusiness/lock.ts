// Flowko U25: locking and unlocking a member, strictly (D1, David: "sign out + no mails"). The lock sets the
// member LOCKED and Cal's User.locked in one transaction (R6): Cal then refuses the user everywhere (sign-in,
// magic link, tRPC isAuthed), the next session refresh ends the session (sessionGuard.ts, P4) and BaseEmail drops
// mail to the user's addresses (lockedRecipients.ts, P6). After the commit the worker's Google grants are removed
// (injected disconnectGoogle = disconnectGoogleOfUser; a failure leaves the lock in effect). A desk-only worker
// gets only the member status (P3: it cannot sign in anyway, and a Cal-locked organizer breaks Cal's cancel); the
// owner can never be locked. Unlock reverses both flags and never goes through Cal's admin handler (it mails).
// lockMember does not refuse a worker with future bookings: the refusal (A2) that sat in the set-up script is lifted
// in U27 (W10); the script prints the business bookings and the owner cancels each through
// viewer.flowko.bookings.cancel.
// Flowko U29c (W2/W3): lockMember no longer returns a list; it answers `futureCount`, the member's business bookings
// counted from the mirror (never the worker's private Cal bookings; the Delavci list shows the details). Lock and
// unlock take the booking writer's worker advisory lock (any member with a user, desk-only included), then the
// member row FOR NO KEY UPDATE, so a racing booking either commits first (and is counted) or is refused
// worker_locked, and two lock/unlock calls cannot leave member status and User.locked disagreeing. Unlock refuses a
// member that is not LOCKED (member_not_locked): it never clears a Cal-admin lock of an ACTIVE member; unlocking a
// LOCKED member clears User.locked whoever set it (C14: Flowko keeps no flag to tell the two locks apart). Lock
// failures are member_conflict (memberTx). Light imports only: the Vault set-up script `require`s this module in
// the container.
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { mayManageBusiness, requireBusinessAccess } from "./access";
import { type FlowkoDb, withFlowkoTx } from "./db";
import type { GoogleDisconnect } from "./disconnectGoogle";
import { FlowkoBusinessError } from "./errors";
// Flowko U29c: light modules only (memberTx: ./db, ./errors, Prisma; workerLock: a Prisma type only; rosterImpact:
// pure @calcom/lib helpers + zod, enums, a ./db type). Never workers.ts, bookingWriter.ts or roster.ts here.
import { memberTx } from "./memberTx";
import { mirrorBookingsOfMembers } from "./rosterImpact";
import { lockWorkerAdvisory } from "./workerLock";

export type { GoogleDisconnect } from "./disconnectGoogle";

export type FutureBooking = {
  id: number;
  uid: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
};

/** Bookings that still bind the worker: not cancelled or rejected, and not yet over. */
const BINDING_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.PENDING,
  BookingStatus.AWAITING_HOST,
];

/**
 * Sets the member's lock state; idempotent (an unchanged state writes nothing and keeps lockedAt). Cal's
 * User.locked follows only for a login member (P3: not for a desk-only worker; staff without a login has no
 * user). No owner check: a Flowko admin tool (the set-up script) and lockMember/unlockMember call it.
 * Refusals: forbidden (missing member), owner_cannot_be_locked.
 */
export async function setMemberLock(
  db: FlowkoDb,
  memberId: number,
  locked: boolean,
  now: Date
): Promise<{ memberId: number; userId: number | null; status: "ACTIVE" | "LOCKED"; userLocked: boolean }> {
  return withFlowkoTx(db, async (tx) => {
    // Flowko U29c: the member row lock first (the set-up script calls this directly); a no-op re-take when
    // lockMember/unlockMember already hold it in this transaction. NO KEY: FK inserts that reference the member
    // (mirror, roster days, booking actions) are not blocked. Prismock ignores it (integration tests prove it).
    await lockMemberRow(tx, memberId);
    // The user is read through the member relation: Cal's excludeLockedUsers extension does not apply.
    const member = await tx.flowkoBusinessMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        role: true,
        status: true,
        userId: true,
        user: { select: { email: true, locked: true } },
      },
    });
    if (!member) throw new FlowkoBusinessError("forbidden");
    if (locked && member.role === FlowkoBusinessRole.OWNER)
      throw new FlowkoBusinessError("owner_cannot_be_locked");

    const status = locked ? FlowkoMemberStatus.LOCKED : FlowkoMemberStatus.ACTIVE;
    if (member.status !== status) {
      await tx.flowkoBusinessMember.update({
        where: { id: member.id },
        data: { status, lockedAt: locked ? now : null },
      });
    }

    let userLocked = member.user?.locked ?? false;
    const loginMember =
      member.userId !== null && member.user !== null && !isFlowkoDeskEmail(member.user.email);
    if (loginMember && member.userId !== null && userLocked !== locked) {
      await tx.user.update({ where: { id: member.userId }, data: { locked } });
      userLocked = locked;
    }
    return { memberId: member.id, userId: member.userId, status, userLocked };
  });
}

// Flowko U29c: the member row lock of lock/unlock (W2/W3); $executeRaw, then the caller's normal re-read.
async function lockMemberRow(tx: Prisma.TransactionClient, memberId: number): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "FlowkoBusinessMember" WHERE "id" = ${memberId} FOR NO KEY UPDATE`;
}

/**
 * Flowko U29c: the locks of lock and unlock, in the booking writer's order (worker advisory, then the row): the
 * advisory for every member with a user (login and desk-only workers; the writer locks every column worker's user),
 * so a booking being written for this worker finishes before the status changes. `userId` comes from the read
 * before the transaction: a member's userId never changes in U29c (no writer sets it), so it is safe to use here.
 */
async function lockMemberForChange(
  tx: Prisma.TransactionClient,
  member: { id: number; userId: number | null }
): Promise<void> {
  if (member.userId !== null) await lockWorkerAdvisory(tx, member.userId);
  await lockMemberRow(tx, member.id);
}

/** The member, if it belongs to the actor's business and the actor may manage it (owner); forbidden otherwise. */
async function managedMemberOrThrow(
  db: FlowkoDb,
  actorUserId: number,
  memberId: number
): Promise<{ id: number; userId: number | null; loginMember: boolean }> {
  const access = await requireBusinessAccess(db, actorUserId);
  if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
  const member = await db.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    // Flowko U29c: the e-mail through the relation (excludeLockedUsers does not apply) for loginMember.
    select: { id: true, businessId: true, userId: true, user: { select: { email: true } } },
  });
  // A missing member answers like another business's one (same FORBIDDEN).
  if (!member || member.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  // Flowko U29c: a login member as setMemberLock defines it (a user with a non-desk e-mail); a member's user never
  // changes. Flowko U29d (D4): a desk user's placeholder e-mail changes once, when the worker accepts an invite
  // (inviteAccept.ts, under the worker advisory lock and the member row lock, as lock/unlock take them). So this
  // pre-transaction read can be stale: setMemberLock re-reads inside the transaction and sets User.locked right; only
  // the Google disconnect after it is skipped for a conversion that commits in between (harmless: a just-converted
  // login has no Google grants yet).
  const loginMember = member.userId !== null && member.user !== null && !isFlowkoDeskEmail(member.user.email);
  return { id: member.id, userId: member.userId, loginMember };
}

/**
 * The owner locks a member of their business. Flowko U29c (W2): under the worker advisory lock and the member row
 * lock, setMemberLock (re-reads; committed), then the Google disconnect for a login member only (desk-only and
 * staff without a login answer google "none"), then `futureCount` from the member's mirror (holding, not over).
 * Locking an already LOCKED member re-runs only the disconnect (the retry path). No mail (C8).
 */
export async function lockMember(
  deps: { db: FlowkoDb; disconnectGoogle: (userId: number) => Promise<GoogleDisconnect> },
  actorUserId: number,
  memberId: number,
  now: Date
): Promise<{ status: "LOCKED"; google: GoogleDisconnect; futureCount: number }> {
  const { db, disconnectGoogle } = deps;
  const member = await managedMemberOrThrow(db, actorUserId, memberId);
  await memberTx(db, async (tx) => {
    await lockMemberForChange(tx, member);
    await setMemberLock(tx, member.id, true, now);
  });
  // Only a login member can sign in to Cal and hold Google grants; desk-only and no-user members answer "none".
  const google: GoogleDisconnect =
    member.loginMember && member.userId !== null ? await disconnectGoogle(member.userId) : "none";
  const futureCount = (await mirrorBookingsOfMembers(db, [member.id], {}, now)).get(member.id)?.length ?? 0;
  return { status: "LOCKED", google, futureCount };
}

/**
 * The owner unlocks a member of their business: member ACTIVE and Cal's User.locked cleared. Sends no mail.
 * Flowko U29c (W3): the same locks as lockMember, the status re-read inside the transaction, and anything but
 * LOCKED is member_not_locked (an ACTIVE member's Cal-admin lock is never cleared).
 */
export async function unlockMember(
  db: FlowkoDb,
  actorUserId: number,
  memberId: number,
  now: Date
): Promise<{ status: "ACTIVE" }> {
  const member = await managedMemberOrThrow(db, actorUserId, memberId);
  await memberTx(db, async (tx) => {
    await lockMemberForChange(tx, member);
    const current = await tx.flowkoBusinessMember.findUnique({
      where: { id: member.id },
      select: { status: true },
    });
    if (!current) throw new FlowkoBusinessError("forbidden");
    if (current.status !== FlowkoMemberStatus.LOCKED) throw new FlowkoBusinessError("member_not_locked");
    await setMemberLock(tx, member.id, false, now);
  });
  return { status: "ACTIVE" };
}

/**
 * The user's bookings as organizer that are not over yet (endTime after `now`; an ongoing one included) and
 * still bind them (ACCEPTED, PENDING, AWAITING_HOST), by start time. No actor check: a Flowko admin tool and
 * internal callers only; screens go through listFutureBookingsOfMember.
 */
export async function futureBookingsOfUser(
  db: FlowkoDb,
  userId: number,
  now: Date
): Promise<FutureBooking[]> {
  return db.booking.findMany({
    where: { userId, endTime: { gt: now }, status: { in: BINDING_STATUSES } },
    select: { id: true, uid: true, startTime: true, endTime: true, status: true },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
  });
}

/** futureBookingsOfUser for a member of the owner's business; staff without a login has none. */
export async function listFutureBookingsOfMember(
  db: FlowkoDb,
  actorUserId: number,
  memberId: number,
  now: Date
): Promise<FutureBooking[]> {
  const member = await managedMemberOrThrow(db, actorUserId, memberId);
  if (member.userId === null) return [];
  return futureBookingsOfUser(db, member.userId, now);
}
