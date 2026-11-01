/**
 * Flowko U14: dates in the UI language. dayjs `.format("MMM D")` and date-fns `format()` print English month
 * names unless a locale is loaded for each call, so screens use Intl, which follows the language it is given.
 * Dates the app keeps as UTC calendar days (out of office, private link expiry) are shown in UTC.
 */
type DateLike = Date | string | number | { toDate: () => Date };

function toDate(date: DateLike): Date {
  if (date instanceof Date) return date;
  if (typeof date === "object" && "toDate" in date) return date.toDate();
  return new Date(date);
}

export function formatLocalizedDay(
  date: DateLike,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
  /** An IANA zone; `null` means the browser's own zone (for a Date the user picked on screen). */
  timeZone: string | null = "UTC"
): string {
  return new Intl.DateTimeFormat(locale, { ...(timeZone ? { timeZone } : {}), ...options }).format(toDate(date));
}
