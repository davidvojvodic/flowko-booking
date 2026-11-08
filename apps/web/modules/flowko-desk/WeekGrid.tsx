// Flowko U28: the desk week view (D2): one worker x the seven days of a Monday-based business week. It shares
// WorkerColumn, BookingBlock and HourAxis with the day view; the hour axis is the union over the seven days
// (`hourRange` per day, widened to the same whole local hours so the days line up). A tap on a day header opens
// that day's day view; a tap on an empty spot books that worker on that day (R10), and in move mode moves the
// moving booking there (R12). The now-line and the past shading follow the server's clock (R18).
import { useMemo } from "react";

import type { DeskView } from "@calcom/features/flowkoBusiness/desk";
import { formatHm, hourRange, rangeSpans, toPx } from "@calcom/lib/flowkoBusiness/desk";
import { addDays, todayIn, weekdayOf } from "@calcom/lib/flowkoBusiness/roster";
import type { Interval } from "@calcom/lib/flowkoSalon";
import { dayBounds, wallClockToMs } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { ms } from "./BookingBlock";
import { DESK_PX_PER_MINUTE } from "./DayGrid";
import { HourAxis } from "./HourAxis";
import { NowLine, deskNowMs, useMinuteTick } from "./NowLine";
import type { DeskBookTarget } from "./WorkerColumn";
import { WorkerColumn } from "./WorkerColumn";

const AXIS_WIDTH = "3.5rem";
const MINUTE_MS = 60_000;
const WEEK_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The Monday of the week that holds the business-local `date` (calendar arithmetic, never a time zone or a profile setting). */
export function mondayOf(date: string): string {
  return addDays(date, -WEEK_ORDER.indexOf(weekdayOf(date) as (typeof WEEK_ORDER)[number]));
}

const pad = (n: number) => String(n).padStart(2, "0");
const hourOf = (at: number, timeZone: string) => Number(formatHm(at, timeZone).slice(0, 2));

/**
 * One hour range per day of the week (R14): each day's own range (opening, shifts, time off, bookings; fallback
 * 08-18) widened to the earliest start and the latest end of the seven, in whole local hours, so the columns line
 * up with one axis. Other busy time never widens it.
 */
export function weekRanges(
  view: DeskView
): Array<{ date: string; day: Interval; range: ReturnType<typeof hourRange> }> {
  const tz = view.timeZone;
  const own = view.days.map((d) => {
    const day = dayBounds(d.date, tz);
    const r = hourRange(
      day,
      tz,
      rangeSpans({
        opening: d.opening,
        columns: d.columns,
        bookings: d.bookings.map((b) => ({ start: ms(b.start), end: ms(b.end) })),
      })
    );
    return { date: d.date, day, startH: hourOf(r.from, tz), endH: r.to >= day.end ? 24 : hourOf(r.to, tz) };
  });
  const lo = Math.min(...own.map((o) => o.startH));
  const hi = Math.max(...own.map((o) => o.endH));
  return own.map((o) => {
    const span = {
      start: wallClockToMs(o.date, `${pad(lo)}:00`, tz),
      end: hi >= 24 ? o.day.end : wallClockToMs(o.date, `${pad(hi)}:00`, tz),
    };
    return { date: o.date, day: o.day, range: hourRange(o.day, tz, [span]) };
  });
}

function formatDayLabel(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function WeekGrid(props: {
  view: DeskView;
  /** When the answer arrived on this device (react-query dataUpdatedAt). */
  receivedAt: number;
  onBook: (target: DeskBookTarget) => void;
  /** Columns that take taps (R5: a WORKER books only her own column). Default: every unlocked one. */
  canBook?: (column: { memberId: number; isMe: boolean }) => boolean;
  onOpenDetails: (bookingId: number) => void;
  /** A tap on a day header: that day's day view. */
  onOpenDay: (date: string) => void;
  /** R12: move mode for this worker's booking: a week of another worker is dimmed. */
  movingMemberId?: number | null;
}) {
  const { t, i18n } = useLocale();
  const { view } = props;
  const px = DESK_PX_PER_MINUTE;
  const tz = view.timeZone;
  useMinuteTick();

  const days = useMemo(() => weekRanges(view), [view]);
  const axis = days[0]?.range;

  const serverNow = ms(view.now);
  const now = deskNowMs(serverNow, props.receivedAt || serverNow, view.slotStepMinutes, Date.now());
  const stepMs = view.slotStepMinutes * MINUTE_MS;
  const today = todayIn(tz, new Date(now));
  const template = `${AXIS_WIDTH} repeat(${view.days.length}, minmax(7.5rem, 1fr))`;
  const language = i18n?.language ?? "sl";

  if (!axis) return <p className="text-subtle py-8 text-center text-sm">{t("flowko_desk_no_columns")}</p>;

  return (
    <div className="border-subtle bg-default max-h-[calc(100dvh-13rem)] overflow-auto rounded-md border">
      <div className="grid min-w-full" style={{ gridTemplateColumns: template }}>
        <div className="bg-default border-subtle sticky left-0 top-0 z-50 border-b" />
        {view.days.map((d) => (
          <button
            key={d.date}
            type="button"
            data-testid={`desk-week-header-${d.date}`}
            data-today={d.date === today ? "true" : undefined}
            onClick={() => props.onOpenDay(d.date)}
            className={classNames(
              "bg-default border-subtle hover:bg-subtle sticky top-0 z-40 flex min-w-0 flex-col items-start border-b border-l px-2 py-2 text-left text-sm font-semibold",
              d.date === today ? "text-brand-default" : "text-emphasis"
            )}>
            <span className="max-w-full truncate">{formatDayLabel(d.date, language)}</span>
            {d.holiday && (
              <span className="text-attention max-w-full truncate text-xs font-normal">{d.holiday.name}</span>
            )}
          </button>
        ))}
        <div className="bg-default sticky left-0 z-40 pt-1">
          <HourAxis range={axis} pxPerMinute={px} />
        </div>
        <div className="relative" style={{ gridColumn: `2 / span ${view.days.length}` }}>
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${view.days.length}, minmax(7.5rem, 1fr))` }}>
            {view.days.map((d, i) => {
              const column = d.columns[0];
              const { day, range } = days[i];
              if (!column) return <div key={d.date} className="border-subtle border-l" />;
              const pastUntil = day.start + Math.floor((now - day.start) / stepMs) * stepMs;
              const bookable = !column.locked && (!props.canBook || props.canBook(column));
              return (
                <div key={d.date} className="relative">
                  <WorkerColumn
                    column={column}
                    testKey={d.date}
                    bookings={d.bookings.filter((b) => b.memberId === column.memberId)}
                    day={day}
                    opening={d.opening}
                    range={range}
                    pxPerMinute={px}
                    timeZone={tz}
                    stepMinutes={view.slotStepMinutes}
                    pastUntil={pastUntil}
                    onBook={bookable ? props.onBook : undefined}
                    onOpenDetails={props.onOpenDetails}
                    dimmed={
                      props.movingMemberId !== undefined &&
                      props.movingMemberId !== null &&
                      column.memberId !== props.movingMemberId
                    }
                  />
                  {d.date === today && (
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
              );
            })}
          </div>
          {axis.hours.map((h) => (
            <div
              key={h.at}
              aria-hidden
              className="border-subtle pointer-events-none absolute inset-x-0 z-[1] border-t"
              style={{ top: `${toPx(h.at, axis, px)}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
