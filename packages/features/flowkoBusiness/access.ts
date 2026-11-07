// Flowko U25: who is in which business with which role, and whether a user may see or act on a booking.
// tRPC-free; consumed by the U26–U29 routers. Rules: the owner (and the desk = the owner's account) has full
// control; a worker sees every booking of the business but acts only on their own (R8: no confirm/decline of a
// colleague's); staff with a login has booking rights for everyone but no settings or roster (P11); a LOCKED
// member, a desk-only placeholder or a user in no business has no access; another business's booking answers
// exactly like a missing one (same FORBIDDEN). A booking belongs to the business of its organizer's membership,
// and only from the moment the organizer joined (P10, David's A1): earlier bookings stay private and are reached
// only through Cal. Cal's BookingAccessService answers one boolean for see and act and its permission stubs
// fail open (Teams), so this module never consults Team, Membership or the permission services. Server only.
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";

// Ruling 13: role and status types come from the generated enums, not restated unions.
export type FlowkoRole = FlowkoBusinessRole;
export type BusinessAccess = { businessId: number; memberId: number; userId: number; role: FlowkoRole };
export type BookingIntent = "see" | "act";
export type MemberRef = {
  memberId: number;
  businessId: number;
  role: FlowkoRole;
  status: FlowkoMemberStatus;
};
/** The organizer of a booking as the business sees it. memberSince = the organizer's member createdAt. */
export type BookingOrganizer = { userId: number; businessId: number | null; memberSince: Date | null };
export type MemberView = MemberRef & {
  userId: number | null;
  displayName: string;
  deskOnly: boolean;
  hasColumn: boolean;
};

/** OWNER and WORKER have a column in the calendar; STAFF does not. */
function hasColumn(role: FlowkoRole): boolean {
  return role === FlowkoBusinessRole.OWNER || role === FlowkoBusinessRole.WORKER;
}

/**
 * May `access` see or act on a booking organized by `organizer`? False when the organizer is in no business or
 * another one, and when the booking was created before the organizer joined (A1; a missing join date fails
 * closed). Within the business: OWNER and STAFF may do both (P11); a WORKER may see every booking and act only
 * on bookings they organize (R8).
 */
export function mayOnBooking(
  access: BusinessAccess,
  organizer: BookingOrganizer,
  booking: { createdAt: Date },
  intent: BookingIntent
): boolean {
  if (organizer.businessId === null || organizer.businessId !== access.businessId) return false;
  if (organizer.memberSince === null) return false;
  if (booking.createdAt.getTime() < organizer.memberSince.getTime()) return false;
  if (access.role === FlowkoBusinessRole.OWNER || access.role === FlowkoBusinessRole.STAFF) return true;
  if (intent === "see") return true;
  return organizer.userId === access.userId;
}

/** Business settings (profile, services, members): the owner only. */
export function mayManageBusiness(access: BusinessAccess): boolean {
  return access.role === FlowkoBusinessRole.OWNER;
}

/**
 * May `access` book into `worker`'s column? Only an ACTIVE OWNER or WORKER of the same business has a column to
 * book into; OWNER and STAFF may book for any of them, a WORKER only for self.
 */
export function mayBookFor(access: BusinessAccess, worker: MemberRef): boolean {
  if (worker.businessId !== access.businessId) return false;
  if (worker.status !== FlowkoMemberStatus.ACTIVE || !hasColumn(worker.role)) return false;
  if (access.role === FlowkoBusinessRole.OWNER || access.role === FlowkoBusinessRole.STAFF) return true;
  return worker.memberId === access.memberId;
}

/**
 * May `access` edit `worker`'s roster (working hours, absences)? Only an OWNER or WORKER of the same business has
 * a roster (a LOCKED one included: the owner may tidy it); OWNER may edit any of them, a WORKER only their own,
 * STAFF never (P11).
 */
export function mayEditRoster(access: BusinessAccess, worker: MemberRef): boolean {
  if (worker.businessId !== access.businessId || !hasColumn(worker.role)) return false;
  if (access.role === FlowkoBusinessRole.OWNER) return true;
  if (access.role === FlowkoBusinessRole.WORKER) return worker.memberId === access.memberId;
  return false;
}

/**
 * The business access of a signed-in user, or null: no member row, a LOCKED member, a Cal-locked user (fail
 * closed even if the member row says ACTIVE), or a desk-only placeholder address (no login by design).
 * The user is read through the member relation, so Cal's excludeLockedUsers extension does not apply and the
 * lock is checked here explicitly.
 */
export async function getBusinessAccess(db: FlowkoDb, userId: number): Promise<BusinessAccess | null> {
  const member = await db.flowkoBusinessMember.findUnique({
    where: { userId },
    select: {
      id: true,
      businessId: true,
      role: true,
      status: true,
      user: { select: { email: true, locked: true } },
    },
  });
  if (!member || !member.user) return null;
  if (member.status !== FlowkoMemberStatus.ACTIVE || member.user.locked) return null;
  if (isFlowkoDeskEmail(member.user.email)) return null;
  return { businessId: member.businessId, memberId: member.id, userId, role: member.role };
}

/** getBusinessAccess, or FlowkoBusinessError("forbidden"). */
export async function requireBusinessAccess(db: FlowkoDb, userId: number): Promise<BusinessAccess> {
  const access = await getBusinessAccess(db, userId);
  if (!access) throw new FlowkoBusinessError("forbidden");
  return access;
}

/**
 * Loads the booking and its organizer's membership and applies mayOnBooking. A missing booking, a booking
 * without an organizer, one of another business, one from before its organizer joined, and a refused intent
 * all throw the same FlowkoBusinessError("forbidden") (missing = foreign).
 */
export async function requireBookingAccess(
  db: FlowkoDb,
  userId: number,
  bookingId: number,
  intent: BookingIntent
): Promise<{
  access: BusinessAccess;
  booking: { id: number; uid: string; userId: number; createdAt: Date };
}> {
  const access = await requireBusinessAccess(db, userId);
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, uid: true, userId: true, createdAt: true },
  });
  if (!booking || booking.userId === null) throw new FlowkoBusinessError("forbidden");
  const organizerUserId = booking.userId;

  const organizerMember = await db.flowkoBusinessMember.findUnique({
    where: { userId: organizerUserId },
    select: { businessId: true, createdAt: true },
  });
  const organizer: BookingOrganizer = {
    userId: organizerUserId,
    businessId: organizerMember?.businessId ?? null,
    memberSince: organizerMember?.createdAt ?? null,
  };
  if (!mayOnBooking(access, organizer, { createdAt: booking.createdAt }, intent)) {
    throw new FlowkoBusinessError("forbidden");
  }
  return {
    access,
    booking: { id: booking.id, uid: booking.uid, userId: organizerUserId, createdAt: booking.createdAt },
  };
}

/**
 * Every member of the business (LOCKED included) ordered by position, then id. The desk-only flag comes from
 * the member's user relation; users are never listed through a top-level user.findMany.
 */
export async function listMembers(db: FlowkoDb, businessId: number): Promise<MemberView[]> {
  const members = await db.flowkoBusinessMember.findMany({
    where: { businessId },
    select: {
      id: true,
      businessId: true,
      role: true,
      status: true,
      userId: true,
      displayName: true,
      user: { select: { email: true } },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return members.map((m) => ({
    memberId: m.id,
    businessId: m.businessId,
    role: m.role,
    status: m.status,
    userId: m.userId,
    displayName: m.displayName,
    deskOnly: m.user !== null && isFlowkoDeskEmail(m.user.email),
    hasColumn: hasColumn(m.role),
  }));
}
