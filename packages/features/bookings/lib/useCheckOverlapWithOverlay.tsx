import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { formatSpanBoundary } from "@calcom/lib/formatSpanBoundary";

import { useOverlayCalendarStore } from "../Booker/components/OverlayCalendar/store";

export function useCheckOverlapWithOverlay({
  start,
  selectedDuration,
  offset,
  language,
}: {
  start: Dayjs;
  selectedDuration: number | null;
  offset: number;
  /** Flowko: the app language, for the date of busy times spanning several days */
  language?: string;
}) {
  const overlayBusyDates = useOverlayCalendarStore((state) => state.overlayBusyDates);

  let overlappingTimeStart: string | null = null;
  let overlappingTimeEnd: string | null = null;
  let overlappingTitle: string | null = null;

  const isOverlapping =
    overlayBusyDates &&
    overlayBusyDates.some((busyDate) => {
      const busyDateStart = dayjs(busyDate.start);
      const busyDateEnd = dayjs(busyDate.end);
      const selectedEndTime = dayjs(start.add(offset, "hours")).add(selectedDuration ?? 0, "minute");

      const isOverlapping =
        (selectedEndTime.isSame(busyDateStart) || selectedEndTime.isAfter(busyDateStart)) &&
        start.add(offset, "hours") < busyDateEnd &&
        selectedEndTime > busyDateStart;

      // Busy times spanning several days need the date, the time alone would be ambiguous
      const multiDay = !busyDateStart.isSame(busyDateEnd, "day");
      overlappingTimeStart = isOverlapping ? formatSpanBoundary(busyDateStart, multiDay, language) : null;
      overlappingTimeEnd = isOverlapping ? formatSpanBoundary(busyDateEnd, multiDay, language) : null;
      overlappingTitle = isOverlapping ? (busyDate.title ?? null) : null;

      return isOverlapping;
    });

  return { isOverlapping, overlappingTimeStart, overlappingTimeEnd, overlappingTitle } as {
    isOverlapping: boolean;
    overlappingTimeStart: string | null;
    overlappingTimeEnd: string | null;
    overlappingTitle: string | null;
  };
}
