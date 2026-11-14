// Flowko U28: one business booking in a worker's column (R14). Drawn from its step copy: busy steps solid and
// tappable (open the details), processing steps hatched, see-through and pass taps through to the column, so a
// processing gap of a colouring looks and acts free (R10). An untrusted copy (steps null) is one solid block
// (U24 E2). The wrapper itself takes no pointer events; its lane gives the left offset and width. In move mode
// (`passThrough`, R12) the busy steps let taps through too, so a spot under a booking (the moving one's own
// included: „15 min later“) reaches the column's tap handler.
// Flowko U29e (E6, R11): a cancelled booking is one faded block over its whole [start, end] (steps ignored), not
// dashed, its label first („Odpovedala stranka“ / „Odpovedano“, not struck through) and the booking's time, customer
// and services struck through; the aria-label starts with the label. A tap opens its details (the sheet shows who
// cancelled, when and why); in move mode it lets taps through like any block.
import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";
import { formatHm, stepSegments, toPx } from "@calcom/lib/flowkoBusiness/desk";
import type { Ms } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
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

/** Flowko U29e (E6): the i18n key of a cancelled booking's label; null for a live booking. */
export function cancelledLabelKey(b: DeskBooking): string | null {
  if (!b.cancelled) return null;
  return b.cancelled.by === "customer"
    ? "flowko_desk_cancelled_by_customer"
    : "flowko_desk_cancelled_by_desk";
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
  /** Flowko U28 (R12): move mode: busy steps take no pointer events and a tap goes on to the column. */
  passThrough?: boolean;
}) {
  const { t } = useLocale();
  const { booking: b, range, pxPerMinute, timeZone } = props;
  const top = Math.max(ms(b.start), range.from);
  const bottom = Math.min(ms(b.end), range.to);
  const px = (t: Ms) => toPx(t, range, pxPerMinute);
  const time = `${formatHm(ms(b.start), timeZone)}–${formatHm(ms(b.end), timeZone)}`;
  const services = b.serviceNames.join(", ");
  const label = [time, b.customer.name, services].filter(Boolean).join(" · ");
  const tentative = b.status !== "ACCEPTED";
  const cancelledKey = cancelledLabelKey(b);
  const segments = bookingSegments(b)
    .map((s) => ({ ...s, start: Math.max(s.start, top), end: Math.min(s.end, bottom) }))
    .filter((s) => s.end > s.start);
  const firstBusy = segments.findIndex((s) => s.kind === "busy");
  const wrapperStyle = {
    top: `${px(top)}px`,
    height: `${px(bottom) - px(top)}px`,
    left: `${(props.lane / props.lanes) * 100}%`,
    width: `${100 / props.lanes}%`,
    zIndex: props.zIndex,
    pointerEvents: "none" as const,
  };

  if (cancelledKey) {
    // Flowko U29e (E6, R11): one block, faded, struck through, labelled.
    const cancelledText = t(cancelledKey);
    return (
      <div
        data-testid={`desk-booking-${b.bookingId}`}
        data-cancelled={b.cancelled?.by}
        className="absolute px-0.5"
        style={wrapperStyle}>
        <div className="relative h-full">
          <button
            type="button"
            data-kind="cancelled"
            aria-label={`${cancelledText} · ${label}`}
            title={`${cancelledText} · ${label}`}
            onClick={(e) => {
              if (props.passThrough) return;
              e.stopPropagation();
              props.onOpenDetails(b.bookingId);
            }}
            className="bg-muted text-default border-subtle absolute inset-x-0 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs leading-tight opacity-60"
            style={{
              top: "0px",
              height: `${px(bottom) - px(top)}px`,
              pointerEvents: props.passThrough ? "none" : "auto",
            }}>
            <span data-testid="desk-cancelled-label" className="block truncate font-semibold">
              {cancelledText}
            </span>
            <span data-testid="desk-cancelled-text" className="block line-through">
              <span className="block tabular-nums">{time}</span>
              <span className="block truncate">{b.customer.name}</span>
              {services && <span className="block truncate">{services}</span>}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`desk-booking-${b.bookingId}`} className="absolute px-0.5" style={wrapperStyle}>
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
                if (props.passThrough) return;
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
                pointerEvents: props.passThrough ? "none" : "auto",
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
