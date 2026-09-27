import { TRPCError } from "@trpc/server";

/** i18n key the event type pages show for the refusal (en, sl). */
export const SUCCESS_REDIRECT_NOT_AVAILABLE = "success_redirect_not_available_error";

/**
 * Flowko U13-20 (David, Q11 (a)): an event type can't send its bookers to another page after booking. The redirect
 * opened a page on another site in the booker's top window and, with forwardParamsSuccessRedirect on (upstream's
 * default), appended the booker's name, e-mail, phone number, answers and the booking's uid, which cancels the
 * booking, where that site's analytics and ad tags read them.
 *
 * A write that sets a new or changed successRedirectUrl is refused (400). Clearing it ("" or null) always works, and
 * a value the event type already holds may be saved unchanged, so an event type saved before U13 can still be
 * edited; useBookingSuccessRedirect no longer forwards anything to such a URL.
 */
export function ensureNoSuccessRedirect(successRedirectUrl: unknown, currentSuccessRedirectUrl?: string | null) {
  if (successRedirectUrl === undefined || successRedirectUrl === null || successRedirectUrl === "") return;
  if (successRedirectUrl === currentSuccessRedirectUrl) return;
  throw new TRPCError({ code: "BAD_REQUEST", message: SUCCESS_REDIRECT_NOT_AVAILABLE });
}
