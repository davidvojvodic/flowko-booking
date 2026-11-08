// Flowko U27: the server-page guard for Cal's own event-type, availability and out-of-office screens (U28: it
// sends the member to the desk). A WORKER or STAFF member of a business (D2) gets the desk and Cal's bookings
// list only; the business owner configures the business, and the hidden worker mirrors would show up on those
// screens. Uses the global client (like callPage.ts: the Cal pages have no `db`) and reuses nonOwnerMemberOf.
// Server only.
import { nonOwnerMemberOf } from "@calcom/features/flowkoBusiness/mirror";
import { prisma } from "@calcom/prisma";
import { redirect } from "next/navigation";
import { FLOWKO_MEMBER_HOME } from "./deskPage";

/**
 * Non-owner business member (any status) → redirect to the desk (a locked member goes on from there to the
 * bookings list); the owner and a user in no business pass through. Next's redirect throws, so call it outside
 * any try/catch, after the page's session read.
 */
export async function redirectIfCalScreensHidden(userId: number): Promise<void> {
  if (await nonOwnerMemberOf(prisma, userId)) {
    redirect(FLOWKO_MEMBER_HOME); // Flowko U28: was /bookings/upcoming
  }
}
