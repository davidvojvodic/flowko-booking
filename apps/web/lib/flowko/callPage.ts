// Flowko U27: the "call the business" page and the helpers that decide when a Cal page sends a visitor there.
// A column worker of a business (and the hidden mirror event types the business writes on) is booked only by the
// business itself, so Cal's public pages for them (profile, event type, private link, reschedule) redirect to
// /poklicite/<business slug>. Uses the global client (like calGuards.ts: the Cal call sites have no `db`) and
// reuses the mirror.ts lookups. Server only.
import {
  businessBookingByUid,
  mirrorIdsOfUser,
  mirrorOfEventType,
  nonOwnerMemberOf,
} from "@calcom/features/flowkoBusiness/mirror";
import { prisma } from "@calcom/prisma";

/** "/poklicite/<slug>", or "/poklicite/<slug>/embed" for the embed variant. */
export function callPagePath(businessSlug: string, embed: boolean): string {
  const base = `/poklicite/${businessSlug}`;
  return embed ? `${base}/embed` : base;
}

/** The call page of the business whose WORKER or STAFF member this user is (any status); null for anyone else. */
export async function callPageForUser(userId: number): Promise<string | null> {
  const member = await nonOwnerMemberOf(prisma, userId);
  return member ? member.businessSlug : null;
}

/** The business slug when this event type is a worker mirror, else null. */
export async function callPageForEventType(eventTypeId: number): Promise<string | null> {
  const mirror = await mirrorOfEventType(prisma, eventTypeId);
  if (!mirror) return null;
  const business = await prisma.flowkoBusiness.findUnique({
    where: { id: mirror.businessId },
    select: { slug: true },
  });
  return business ? business.slug : null;
}

/**
 * /[user]/[type]: the business slug when the user is a WORKER or STAFF member (any slug), or when `slug` is the
 * slug of the user's own mirror event type (the owner's). Must run BEFORE getPublicEvent: a mirror is hidden
 * and would 404 there instead of redirecting.
 */
export async function callPageForUserSlug(userId: number, slug: string): Promise<string | null> {
  const ofMember = await callPageForUser(userId);
  if (ofMember) return ofMember;
  const { eventTypeIds } = await mirrorIdsOfUser(prisma, userId);
  if (eventTypeIds.length === 0) return null;
  const mirrorType = await prisma.eventType.findFirst({
    where: { userId, slug, id: { in: eventTypeIds } },
    select: { id: true },
  });
  return mirrorType ? callPageForEventType(mirrorType.id) : null;
}

/** The business slug when this booking uid is a business booking (its event type is a mirror), else null. */
export async function callPageForBookingUid(uid: string): Promise<string | null> {
  const booking = await businessBookingByUid(prisma, uid);
  return booking ? booking.businessSlug : null;
}

/** What the call page shows: name, phone and address of the business. Never any customer data. */
export async function loadCallPageBusiness(
  slug: string
): Promise<{ name: string; phone: string | null; address: string | null } | null> {
  return prisma.flowkoBusiness.findUnique({
    where: { slug },
    select: { name: true, phone: true, address: true },
  });
}
