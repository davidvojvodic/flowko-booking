// Flowko U25: locking and unlocking a member, strictly (D1, David: "sign out + no mails"). The lock sets the
// member LOCKED and Cal's User.locked in one transaction (R6): Cal then refuses the user everywhere (sign-in,
// magic link, tRPC isAuthed), the next session refresh ends the session (sessionGuard.ts, P4) and BaseEmail drops
// mail to the user's addresses (lockedRecipients.ts, P6). After the commit the worker's Google grants are removed
// (injected disconnectGoogle = disconnectGoogleOfUser; a failure leaves the lock in effect). A desk-only worker
// gets only the member status (P3: it cannot sign in anyway, and a Cal-locked organizer breaks Cal's cancel); the
// owner can never be locked. Unlock reverses both flags and never goes through Cal's admin handler (it mails).
// lockMember does not refuse a worker with future bookings: the refusal (A2) that sat in the set-up script is lifted
// in U27 (W10); the script prints the business bookings and the owner cancels each through
// viewer.flowko.bookings.cancel. The list is returned for the lock-then-list. Server only.
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { mayManageBusiness, requireBusinessAccess } from "./access";
import { type FlowkoDb, withFlowkoTx } from "./db";
import type { GoogleDisconnect } from "./disconnectGoogle";
import { FlowkoBusinessError } from "./errors";

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

/** The member, if it belongs to the actor's business and the actor may manage it (owner); forbidden otherwise. */
async function managedMemberOrThrow(
  db: FlowkoDb,
  actorUserId: number,
  memberId: number
): Promise<{ id: number; userId: number | null }> {
  const access = await requireBusinessAccess(db, actorUserId);
  if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
  const member = await db.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: { id: true, businessId: true, userId: true },
  });
  // A missing member answers like another business's one (same FORBIDDEN).
  if (!member || member.businessId !== access.businessId) throw new FlowkoBusinessError("forbidden");
  return { id: member.id, userId: member.userId };
}

/**
 * The owner locks a member of their business: setMemberLock (committed), then the Google disconnect, then the
 * member's future bookings. A member without a user (staff without a login) answers google "none" and no
 * bookings (Ruling 10). Locking an already LOCKED member re-runs only the disconnect.
 */
export async function lockMember(
  deps: { db: FlowkoDb; disconnectGoogle: (userId: number) => Promise<GoogleDisconnect> },
  actorUserId: number,
  memberId: number,
  now: Date
): Promise<{ status: "LOCKED"; google: GoogleDisconnect; futureBookings: FutureBooking[] }> {
  const { db, disconnectGoogle } = deps;
  const member = await managedMemberOrThrow(db, actorUserId, memberId);
  await setMemberLock(db, member.id, true, now);
  if (member.userId === null) return { status: "LOCKED", google: "none", futureBookings: [] };
  const google = await disconnectGoogle(member.userId);
  const futureBookings = await futureBookingsOfUser(db, member.userId, now);
  return { status: "LOCKED", google, futureBookings };
}

/** The owner unlocks a member of their business: member ACTIVE and Cal's User.locked cleared. Sends no mail. */
export async function unlockMember(
  db: FlowkoDb,
  actorUserId: number,
  memberId: number
): Promise<{ status: "ACTIVE" }> {
  const member = await managedMemberOrThrow(db, actorUserId, memberId);
  await setMemberLock(db, member.id, false, new Date());
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
