// Flowko U28: the desk day view grid (R4, R14, R15): an hour axis and one column per worker in roster order (a
// locked worker's read-only column last), drawn in the business time zone over the union of opening, shifts, time
// off and the day's bookings (fallback 08-18; DST days 23/25 h from `dayBounds`). CSS grid + absolutely placed
// blocks; header row and hour axis stay in view while the grid scrolls. `onlyMemberId` shows a single column
// (phone). The now-line and the past shading follow the server's clock (R18).
import { useMemo } from "react";

import type { DeskView } from "@calcom/features/flowkoBusiness/desk";
import { hourRange, rangeSpans, toPx } from "@calcom/lib/flowkoBusiness/desk";
import { todayIn } from "@calcom/lib/flowkoBusiness/roster";
import { dayBounds } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { ms } from "./BookingBlock";
import { HourAxis } from "./HourAxis";
import { NowLine, deskNowMs, useMinuteTick } from "./NowLine";
import type { DeskBookTarget } from "./WorkerColumn";
import { WorkerColumn } from "./WorkerColumn";

export const DESK_PX_PER_MINUTE = 2;
const AXIS_WIDTH = "3.5rem";
const MINUTE_MS = 60_000;

export function DayGrid(props: {
  view: DeskView;
  date: string;
  /** When the answer arrived on this device (react-query dataUpdatedAt). */
  receivedAt: number;
  onlyMemberId?: number | null;
  onBook: (target: DeskBookTarget) => void;
  /** Flowko U28 (R5): columns that take taps; a WORKER books only her own column. Default: every unlocked one. */
  canBook?: (column: { memberId: number; isMe: boolean }) => boolean;
  onOpenDetails: (bookingId: number) => void;
  /** Flowko U28 (R12): move mode for this worker's booking: every other column is dimmed. */
  movingMemberId?: number | null;
}) {
  const { t } = useLocale();
  const { view, date } = props;
  const px = DESK_PX_PER_MINUTE;
  const tz = view.timeZone;
  const dayData = view.days[0];
  useMinuteTick();

  const day = useMemo(() => dayBounds(date, tz), [date, tz]);
  const range = useMemo(
    () =>
      hourRange(
        day,
        tz,
        rangeSpans({
          opening: dayData.opening,
          columns: dayData.columns,
          bookings: dayData.bookings.map((b) => ({ start: ms(b.start), end: ms(b.end) })),
        })
      ),
    [day, tz, dayData]
  );

  const serverNow = ms(view.now);
  const now = deskNowMs(serverNow, props.receivedAt || serverNow, view.slotStepMinutes, Date.now());
  const stepMs = view.slotStepMinutes * MINUTE_MS;
  // Start of the current slot on this day's grid: earlier is past (R6, R18).
  const pastUntil = day.start + Math.floor((now - day.start) / stepMs) * stepMs;
  const isToday = date === todayIn(tz, new Date(now));

  const columns = dayData.columns.filter(
    (c) => props.onlyMemberId === undefined || props.onlyMemberId === null || c.memberId === props.onlyMemberId
  );
  const template = `${AXIS_WIDTH} repeat(${columns.length}, minmax(8.5rem, 1fr))`;

  return (
    <div className="flex flex-col gap-2">
      {dayData.holiday && (
        <div
          data-testid="desk-holiday"
          className="bg-semantic-attention-subtle text-attention rounded-md px-3 py-2 text-sm font-medium">
          {t(dayData.holiday.open ? "flowko_desk_holiday_open" : "flowko_desk_holiday_closed", {
            name: dayData.holiday.name,
          })}
        </div>
      )}
      {columns.length === 0 ? (
        <p className="text-subtle py-8 text-center text-sm">{t("flowko_desk_no_columns")}</p>
      ) : (
        <div className="border-subtle bg-default max-h-[calc(100dvh-13rem)] overflow-auto rounded-md border">
          <div className="grid min-w-full" style={{ gridTemplateColumns: template }}>
            <div className="bg-default border-subtle sticky left-0 top-0 z-50 border-b" />
            {columns.map((c) => (
              <div
                key={c.memberId}
                data-testid={`desk-column-header-${c.memberId}`}
                className={classNames(
                  "bg-default border-subtle sticky top-0 z-40 truncate border-b border-l px-2 py-2 text-sm font-semibold",
                  c.locked ? "text-subtle" : "text-emphasis"
                )}>
                {c.locked ? t("flowko_desk_locked_column", { name: c.displayName }) : c.displayName}
              </div>
            ))}
            <div className="bg-default sticky left-0 z-40 pt-1">
              <HourAxis range={range} pxPerMinute={px} />
            </div>
            <div className="relative" style={{ gridColumn: `2 / span ${columns.length}` }}>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(8.5rem, 1fr))` }}>
                {columns.map((c) => (
                  <WorkerColumn
                    key={c.memberId}
                    column={c}
                    bookings={dayData.bookings.filter((b) => b.memberId === c.memberId)}
                    day={day}
                    opening={dayData.opening}
                    range={range}
                    pxPerMinute={px}
                    timeZone={tz}
                    stepMinutes={view.slotStepMinutes}
                    pastUntil={pastUntil}
                    onBook={c.locked || (props.canBook && !props.canBook(c)) ? undefined : props.onBook}
                    onOpenDetails={props.onOpenDetails}
                    dimmed={
                      props.movingMemberId !== undefined &&
                      props.movingMemberId !== null &&
                      c.memberId !== props.movingMemberId
                    }
                  />
                ))}
              </div>
              {range.hours.map((h) => (
                <div
                  key={h.at}
                  aria-hidden
                  className="border-subtle pointer-events-none absolute inset-x-0 z-[1] border-t"
                  style={{ top: `${toPx(h.at, range, px)}px` }}
                />
              ))}
              {isToday && (
                <NowLine
                  serverNow={serverNow}
                  receivedAt={props.receivedAt || serverNow}
                  stepMinutes={view.slotStepMinutes}
                  range={range}
                  pxPerMinute={px}
                  timeZone={tz}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
