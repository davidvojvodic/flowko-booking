// Flowko U29a: the page guard of the business settings (/settings/podjetje/*, S15). Owner only: every page calls it
// itself (a layout is not a security boundary: Next does not re-run a matching layout on an RSC partial render).
// Uses the global client and getBusinessAccess (as deskPage.ts), so a locked member, a desk-only placeholder and a
// user in no business have no access. The tRPC procedures behind the pages check the owner again. Server only.
import { getBusinessAccess, mayManageBusiness } from "@calcom/features/flowkoBusiness/access";
import { prisma } from "@calcom/prisma";
import { redirect } from "next/navigation";
import { FLOWKO_MEMBER_HOME } from "./deskPage";

/** Where a user without business access goes: Cal's own settings. */
export const FLOWKO_SETTINGS_NO_BUSINESS_HOME = "/settings/my-account/profile";

/**
 * The owner's business, or a redirect: no business access → Cal's own settings; a WORKER or STAFF member → the
 * desk. Next's redirect throws, so call it outside any try/catch, after the page's session read.
 */
export async function requireBusinessOwnerPage(userId: number): Promise<{ businessId: number }> {
  const access = await getBusinessAccess(prisma, userId);
  if (!access) {
    redirect(FLOWKO_SETTINGS_NO_BUSINESS_HOME);
  }
  if (!mayManageBusiness(access)) {
    redirect(FLOWKO_MEMBER_HOME);
  }
  return { businessId: access.businessId };
}
