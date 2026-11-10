// Flowko U29b (S14): the roster writes' error codes (saveWeek, saveUsualWeeks, and Task 9's absences) and the text
// of each. The Flowko code travels in the tRPC error's `message` (flowkoTrpcError); the rate limiter only in
// `data.code`. `roster_changed` is no toast: the save flow answers it with the „changed meanwhile“ alert, and its key
// is that alert's text. TOO_MANY_REQUESTS and unknown codes reuse the U29a generic texts.

/** The codes with their own toast text `flowko_roster_error_<code>`. */
export const ROSTER_ERROR_CODES = [
  "forbidden",
  "bad_roster",
  "week_out_of_range",
  "roster_conflict",
  "bad_absence",
  "not_a_holiday",
] as const;

export type RosterErrorCode =
  | (typeof ROSTER_ERROR_CODES)[number]
  | "roster_changed"
  | "TOO_MANY_REQUESTS"
  | "unknown";

const KNOWN: readonly string[] = [...ROSTER_ERROR_CODES, "roster_changed", "TOO_MANY_REQUESTS"];

/** A write's error code: the Flowko code in `message`, else the tRPC code (rate limiter), else "unknown". */
export function rosterErrorCode(error: unknown): RosterErrorCode {
  if (typeof error !== "object" || error === null) return "unknown";
  const { message, data } = error as { message?: unknown; data?: { code?: unknown } | null };
  if (typeof message === "string" && KNOWN.includes(message)) return message as RosterErrorCode;
  if (typeof data?.code === "string" && KNOWN.includes(data.code)) return data.code as RosterErrorCode;
  return "unknown";
}

/** The i18n key of a code's text. */
export function rosterErrorKey(code: RosterErrorCode): string {
  if (code === "unknown") return "something_went_wrong";
  if (code === "TOO_MANY_REQUESTS") return "flowko_settings_error_TOO_MANY_REQUESTS";
  if (code === "roster_changed") return "flowko_roster_stale";
  return `flowko_roster_error_${code}`;
}
