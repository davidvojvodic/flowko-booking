// Flowko U28: one business booking in a worker's column (R14). Drawn from its step copy: busy steps solid and
// tappable (open the details), processing steps hatched, see-through and pass taps through to the column, so a
// processing gap of a colouring looks and acts free (R10). An untrusted copy (steps null) is one solid block
// (U24 E2). The wrapper itself takes no pointer events; its lane gives the left offset and width.
import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";
import { formatHm, stepSegments, toPx } from "@calcom/lib/flowkoBusiness/desk";
import type { Ms } from "@calcom/lib/flowkoSalon";
import classNames from "@calcom/ui/classNames";

const HATCH =
  "repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(100, 116, 139, 0.18) 6px, rgba(100, 116, 139, 0.18) 12px)";

export const ms = (iso: string): Ms => new Date(iso).getTime();

/** The booking's step segments in epoch ms (busy only for lanes and free time). */
export function bookingSegments(b: DeskBooking) {
  return stepSegments({
    start: ms(b.start),
    end: ms(b.end),
    steps: b.steps ? b.steps.map((s) => ({ ...s, start: ms(s.start), end: ms(s.end) })) : null,
  });
}

export function BookingBlock(props: {
  booking: DeskBooking;
  range: { from: Ms; to: Ms };
  pxPerMinute: number;
  timeZone: string;
  lane: number;
  lanes: number;
  zIndex: number;
  onOpenDetails: (bookingId: number) => void;
}) {
  const { booking: b, range, pxPerMinute, timeZone } = props;
  const top = Math.max(ms(b.start), range.from);
  const bottom = Math.min(ms(b.end), range.to);
  const px = (t: Ms) => toPx(t, range, pxPerMinute);
  const time = `${formatHm(ms(b.start), timeZone)}–${formatHm(ms(b.end), timeZone)}`;
  const services = b.serviceNames.join(", ");
  const label = [time, b.customer.name, services].filter(Boolean).join(" · ");
  const tentative = b.status !== "ACCEPTED";
  const segments = bookingSegments(b)
    .map((s) => ({ ...s, start: Math.max(s.start, top), end: Math.min(s.end, bottom) }))
    .filter((s) => s.end > s.start);
  const firstBusy = segments.findIndex((s) => s.kind === "busy");

  return (
    <div
      data-testid={`desk-booking-${b.bookingId}`}
      className="absolute px-0.5"
      style={{
        top: `${px(top)}px`,
        height: `${px(bottom) - px(top)}px`,
        left: `${(props.lane / props.lanes) * 100}%`,
        width: `${100 / props.lanes}%`,
        zIndex: props.zIndex,
        pointerEvents: "none",
      }}>
      <div className="relative h-full">
        {segments.map((s, i) =>
          s.kind === "processing" ? (
            <div
              key={`${s.kind}-${s.start}`}
              data-kind="processing"
              data-pattern="hatched"
              aria-hidden
              className="border-brand-default absolute inset-x-0 border-x-2 border-dashed"
              style={{
                top: `${px(s.start) - px(top)}px`,
                height: `${px(s.end) - px(s.start)}px`,
                backgroundImage: HATCH,
                pointerEvents: "none",
              }}
            />
          ) : (
            <button
              key={`${s.kind}-${s.start}`}
              type="button"
              data-kind="busy"
              aria-label={label}
              title={label}
              onClick={(e) => {
                e.stopPropagation();
                props.onOpenDetails(b.bookingId);
              }}
              className={classNames(
                "bg-brand-default text-brand absolute inset-x-0 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm",
                tentative && "border-brand-default border-2 border-dashed opacity-80"
              )}
              style={{
                top: `${px(s.start) - px(top)}px`,
                height: `${px(s.end) - px(s.start)}px`,
                pointerEvents: "auto",
              }}>
              {i === firstBusy && (
                <>
                  <span className="block font-semibold tabular-nums">{time}</span>
                  <span className={classNames("block truncate", b.noShow && "line-through")}>
                    {b.customer.name}
                  </span>
                  {services && <span className="block truncate opacity-80">{services}</span>}
                </>
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
}
