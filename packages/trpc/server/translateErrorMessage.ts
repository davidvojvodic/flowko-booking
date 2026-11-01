import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";

// Flowko U14: the client prints `error.message` of a failed tRPC call as it is in many toasts, so the server
// says the sentence in the caller's language. Only the keys listed here are translated; a handler that throws
// any other string (including keys the client compares or translates itself, such as "invalid_code") keeps it.
const TRANSLATED_KEYS = new Set([
  "invalid_input",
  "unauthorized",
  "error_forbidden",
  "error_not_found",
  "booking_not_found",
  "booking_already_cancelled",
  "user_not_found",
  "no_show_before_start_error",
  "no_show_update_failed",
  "no_access_to_booking",
  "booking_limits_ascending_error",
  "booker_limit_gt_zero_error",
  "duration_limits_ascending_error",
  "offset_start_nonnegative_error",
  "restriction_schedule_not_owned_error",
  "error_event_type_url_duplicate",
  "booking_already_confirmed",
  "not_authorized_to_confirm_booking",
  "booking_needs_organizer_error",
  "cannot_request_reschedule_cancelled",
  "not_booking_owner",
  "booking_already_reported",
  "booking_has_no_attendees",
  "guests_disabled_for_event_type",
  "email_already_used",
  "you_do_not_have_permission",
]);

// A TRPCError thrown with only a code carries the code's name as its message.
const CODE_KEYS: Record<string, string> = {
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "error_forbidden",
  NOT_FOUND: "error_not_found",
  BAD_REQUEST: "invalid_input",
};

const dictionaries = { en, sl } as unknown as Record<string, Record<string, string>>;

/** The message in `locale` (Slovene or English; anything else gets English) when it is one of the listed keys. */
export function translateErrorMessage(message: string, locale?: string | null): string {
  const key = CODE_KEYS[message] ?? message;
  if (!TRANSLATED_KEYS.has(key)) {
    return message;
  }
  const dictionary = dictionaries[locale === "sl" ? "sl" : "en"];
  return dictionary[key] ?? dictionaries.en[key] ?? message;
}
