// Flowko U28: where a business member lands and who may open the desk (/koledar). Uses the global client (like
// calScreensPage.ts: the Cal pages have no `db`) and getBusinessAccess, so a locked member, a desk-only
// placeholder and a user in no business have no desk. Server only.
import { getBusinessAccess } from "@calcom/features/flowkoBusiness/access";
import { prisma } from "@calcom/prisma";
import { redirect } from "next/navigation";

export const FLOWKO_MEMBER_HOME = "/koledar";

/** "/koledar" for a user with business access (any role), else null. */
export async function deskHomeFor(userId: number): Promise<string | null> {
  const access = await getBusinessAccess(prisma, userId);
  return access ? FLOWKO_MEMBER_HOME : null;
}

/**
 * Business access, or a redirect to the bookings list. Next's redirect throws, so call it outside any try/catch,
 * after the page's session read.
 */
export async function requireDeskAccess(userId: number): Promise<{ businessId: number }> {
  const access = await getBusinessAccess(prisma, userId);
  if (!access) {
    redirect("/bookings/upcoming");
  }
  return { businessId: access.businessId };
}
