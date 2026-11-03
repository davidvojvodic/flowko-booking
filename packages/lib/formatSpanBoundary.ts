import type { Dayjs } from "@calcom/dayjs";

/**
 * Flowko: one end of a time span for display. A span within one day shows only `HH:mm`.
 * A span over several days adds the date in the app's language (sl „3. nov., 23:00“),
 * never dayjs's English default („Nov 3, 23:00“), because no dayjs locale is set app-wide.
 */
export function formatSpanBoundary(value: Dayjs, multiDay: boolean, language = "en"): string {
  const time = value.format("HH:mm");
  if (!multiDay) return time;
  const date = new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }).format(value.toDate());
  return `${date}, ${time}`;
}
