// Flowko U28: one worker's column of the desk grid (R3, R10, R14). Background bands (shift = free, off shift and
// closed = grey, time off = grey with a label), the past shaded, other busy time as „Zasedeno“ (times only,
// clipped to the visible hours, see-through to taps so the writer can still be asked), business bookings in
// lanes, and on a Google failure a hatched overlay with the note over the kept bands. A tap on an empty spot
// books the latest free edge between the grid start before the tap and the tap (U24 E3, design call 11); a
// locked column takes no taps (R4).
// Flowko U29e (E6, R11): cancelled bookings (the day read sends them) are drawn over their whole [start, end] beside
// the live ones (deskLaneLayout: never in lane 0, so the left part of a cancelled-only slot stays tappable and books)
// at z-index 6–9 (above the Google overlay, below live blocks); free edges come from live bookings only.
// Flowko U29f (F2, R8): the live bookings alternate tones a/b by (start, id) per column (each week-view day
// restarts at "a"); cancelled ones take no tone and shift none.
import type { MouseEvent } from "react";
import { useMemo } from "react";

import type { DeskBooking, DeskColumn } from "@calcom/features/flowkoBusiness/desk";
import {
  bookingTones,
  columnBands,
  deskLaneLayout,
  freeEdgesFor,
  tapToStart,
  toPx,
} from "@calcom/lib/flowkoBusiness/desk";
import type { Interval, Ms } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { BookingBlock, bookingSegments, ms } from "./BookingBlock";

const MINUTE_MS = 60_000;
// Flowko U29b: exported for Urnik's absent cells.
export const HATCH =
  "repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(100, 116, 139, 0.25) 8px, rgba(100, 116, 139, 0.25) 16px)";

export type DeskBookTarget = { memberId: number; start: Ms };

const BAND_CLASS = {
  shift: "bg-default",
  off_shift: "bg-subtle",
  closed: "bg-muted",
  time_off: "bg-subtle",
} as const;

function clip(i: Interval, range: { from: Ms; to: Ms }): Interval | null {
  const start = Math.max(i.start, range.from);
  const end = Math.min(i.end, range.to);
  return end > start ? { start, end } : null;
}

export function WorkerColumn(props: {
  column: DeskColumn;
  bookings: DeskBooking[];
  day: Interval;
  opening: Interval[];
  range: { from: Ms; to: Ms };
  pxPerMinute: number;
  timeZone: string;
  stepMinutes: number;
  /** Start of the current slot: earlier is past (shaded, not bookable; the current slot stays bookable, R6). */
  pastUntil: Ms;
  onBook?: (target: DeskBookTarget) => void;
  onOpenDetails: (bookingId: number) => void;
  /** Flowko U28 (R12): move mode is on for another worker's booking: this column is dimmed. */
  dimmed?: boolean;
  /** Flowko U28 (R12): move mode is on: taps on bookings go through to this column's tap handler. */
  passThrough?: boolean;
  /** Flowko U28 (week view): the test-id key of this column; the week shows one worker seven times (default: the member id). */
  testKey?: string | number;
}) {
  const { t } = useLocale();
  const { column, bookings, range, pxPerMinute } = props;
  const px = (at: Ms) => toPx(at, range, pxPerMinute);
  const tappable = !column.locked && props.onBook !== undefined;
  const key = props.testKey ?? column.memberId;

  const bands = useMemo(
    () =>
      columnBands({ day: props.day, opening: props.opening, shifts: column.shifts, timeOff: column.timeOff })
        .map((b) => ({ kind: b.kind, ...clip(b, range) }))
        .filter((b): b is { kind: typeof b.kind; start: Ms; end: Ms } => b.start !== undefined),
    [props.day, props.opening, column.shifts, column.timeOff, range]
  );

  const shown = useMemo(
    () =>
      bookings
        .filter((b) => ms(b.end) > range.from && ms(b.start) < range.to)
        .sort((a, b) => ms(a.start) - ms(b.start) || a.bookingId - b.bookingId),
    [bookings, range]
  );
  // Flowko U29e (E6): live bookings keep their busy steps; a cancelled one is its span and never busy time.
  const live = useMemo(() => shown.filter((b) => !b.cancelled), [shown]);
  const cancelled = useMemo(() => shown.filter((b) => b.cancelled), [shown]);
  // Flowko U29f (R8): tones over the live bookings this column draws.
  const tones = useMemo(
    () => bookingTones(live.map((b) => ({ id: b.bookingId, start: ms(b.start) }))),
    [live]
  );
  const busyOf = useMemo(
    () =>
      new Map(
        live.map((b) => [
          b.bookingId,
          bookingSegments(b)
            .filter((s) => s.kind === "busy")
            .map((s) => ({ start: s.start, end: s.end })),
        ])
      ),
    [live]
  );
  const lanes = useMemo(
    () =>
      deskLaneLayout(
        live.map((b) => ({ id: b.bookingId, busy: busyOf.get(b.bookingId) ?? [] })),
        cancelled.map((b) => ({ id: b.bookingId, busy: [{ start: ms(b.start), end: ms(b.end) }] }))
      ),
    [live, cancelled, busyOf]
  );
  const freeEdges = useMemo(
    () =>
      freeEdgesFor({
        shifts: column.shifts,
        timeOff: column.timeOff,
        busy: [...column.otherBusy, ...Array.from(busyOf.values()).flat()],
      }),
    [column.shifts, column.timeOff, column.otherBusy, busyOf]
  );
  const otherBusy = column.otherBusy.map((i) => clip(i, range)).filter((i): i is Interval => i !== null);
  const pastEnd = Math.min(Math.max(props.pastUntil, range.from), range.to);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!tappable || !props.onBook) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const tapMs = range.from + (y / pxPerMinute) * MINUTE_MS;
    if (tapMs < range.from || tapMs >= range.to) return;
    const start = tapToStart(tapMs, props.day, props.stepMinutes, freeEdges);
    if (start < props.pastUntil) return;
    props.onBook({ memberId: column.memberId, start });
  };

  return (
    <div
      data-testid={`desk-column-${key}`}
      data-tap={tappable ? "book" : undefined}
      data-dimmed={props.dimmed ? "true" : undefined}
      onClick={tappable ? onClick : undefined}
      className={classNames(
        "border-subtle relative overflow-hidden border-l",
        tappable ? "cursor-pointer" : "cursor-default",
        props.dimmed && "opacity-40"
      )}
      style={{ height: `${px(range.to)}px` }}>
      {bands.map((b) => (
        <div
          key={`${b.kind}-${b.start}`}
          data-band={b.kind}
          data-pattern={b.kind === "time_off" ? "hatched" : undefined}
          className={classNames(
            "absolute inset-x-0",
            BAND_CLASS[b.kind],
            b.kind === "time_off" && "text-subtle px-1.5 pt-1 text-xs"
          )}
          style={{
            top: `${px(b.start)}px`,
            height: `${px(b.end) - px(b.start)}px`,
            backgroundImage: b.kind === "time_off" ? HATCH : undefined,
          }}>
          {b.kind === "time_off" ? t("flowko_desk_time_off") : null}
        </div>
      ))}
      {pastEnd > range.from && (
        <div
          data-testid={`desk-past-${key}`}
          aria-hidden
          className="bg-emphasis pointer-events-none absolute inset-x-0 top-0 opacity-40"
          style={{ height: `${px(pastEnd)}px` }}
        />
      )}
      {otherBusy.map((i) => (
        <div
          key={i.start}
          data-testid="desk-other-busy"
          className="bg-inverted text-inverted absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-xs opacity-60"
          style={{ top: `${px(i.start)}px`, height: `${px(i.end) - px(i.start)}px`, pointerEvents: "none" }}>
          {t("flowko_desk_busy")}
        </div>
      ))}
      {cancelled.map((b, index) => {
        const lane = lanes.get(b.bookingId) ?? { lane: 1, lanes: 2 };
        return (
          <BookingBlock
            key={b.bookingId}
            booking={b}
            range={range}
            pxPerMinute={pxPerMinute}
            timeZone={props.timeZone}
            lane={lane.lane}
            lanes={lane.lanes}
            zIndex={6 + Math.min(index, 3)}
            onOpenDetails={props.onOpenDetails}
            passThrough={props.passThrough}
          />
        );
      })}
      {live.map((b, index) => {
        const lane = lanes.get(b.bookingId) ?? { lane: 0, lanes: 1 };
        return (
          <BookingBlock
            key={b.bookingId}
            booking={b}
            range={range}
            pxPerMinute={pxPerMinute}
            timeZone={props.timeZone}
            lane={lane.lane}
            lanes={lane.lanes}
            zIndex={10 + index}
            onOpenDetails={props.onOpenDetails}
            passThrough={props.passThrough}
            tone={tones.get(b.bookingId)}
          />
        );
      })}
      {column.googleUnavailable && (
        <div
          data-testid={`desk-google-unavailable-${key}`}
          data-pattern="hatched"
          className="text-subtle absolute inset-0 z-[5] px-1.5 pt-1 text-xs font-medium"
          style={{ backgroundImage: HATCH, pointerEvents: "none" }}>
          {t("flowko_desk_google_unavailable")}
        </div>
      )}
    </div>
  );
}
