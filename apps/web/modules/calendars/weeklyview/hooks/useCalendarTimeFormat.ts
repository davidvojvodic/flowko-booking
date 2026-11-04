import { useTimePreferences } from "@calcom/features/bookings/lib";
import { useCalendarStore } from "@calcom/features/calendars/weeklyview/state/store";
import type { TimeFormat } from "@calcom/lib/timeFormat";

/**
 * Flowko U19: the time format for the weekly view's labels. A calendar that is handed
 * `timeFormat` (the host's bookings calendar, from the profile) uses it; every other
 * weekly view keeps the booker preference (browser-detected) as upstream.
 */
export function useCalendarTimeFormat(): TimeFormat {
  const fromCalendar = useCalendarStore((state) => state.timeFormat);
  const { timeFormat: fromBooker } = useTimePreferences();
  return fromCalendar ?? fromBooker;
}
