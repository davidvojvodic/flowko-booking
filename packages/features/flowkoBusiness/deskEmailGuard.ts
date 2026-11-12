// Flowko U27 (E4): the desk placeholder domain (`@flowko.invalid`, U25) is never typed in and never typed out.
// A desk-only worker's address is generated, unique and undeliverable; if it could be changed to a real one, or a
// real user could take one, Cal's mail filters (Task 4) and the access rules would be working from wrong facts.
// Server only. Shared by the profile, secondary-e-mail and admin-user handlers; refusal = BAD_REQUEST, no write.
// Flowko U29d (D3/D4): a placeholder is replaced only by the invite accept (inviteAccept.ts, C9: the desk-only
// worker's own user row gets the invited real address, once), never by a user or admin edit; these checks are
// unchanged and that writer does not pass through them (source pin inviteAccept.guard.test.ts).
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import { TRPCError } from "@trpc/server";

export const INVALID_EMAIL_ADDRESS = "invalid_email_address";

const refuse = (): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message: INVALID_EMAIL_ADDRESS });
};

/** An address that is to be stored (a secondary e-mail): refused when it is on the desk domain. */
export function refuseDeskAddress(email: string | null | undefined): void {
  if (email && isFlowkoDeskEmail(email)) refuse();
}

/**
 * A change of an account's primary e-mail from `currentEmail` to `newEmail`: refused when the new address is on
 * the desk domain, or when the current one is (a desk-only user keeps their placeholder). An unchanged address
 * (same text, any case) or no address in the input is not a change.
 */
export function refuseDeskEmailChange(currentEmail: string, newEmail: string | null | undefined): void {
  if (!newEmail || newEmail.toLowerCase() === currentEmail.toLowerCase()) return;
  if (isFlowkoDeskEmail(newEmail) || isFlowkoDeskEmail(currentEmail)) refuse();
}
