// Flowko U28: the hour axis of the desk grid: one 24-hour label per whole local hour of the visible range (a DST
// day has 23 or 25), each at its pixel offset (labels come from `hourRange`, business time zone).
import type { hourRange } from "@calcom/lib/flowkoBusiness/desk";
import { toPx } from "@calcom/lib/flowkoBusiness/desk";

export type DeskRange = ReturnType<typeof hourRange>;

export function HourAxis({ range, pxPerMinute }: { range: DeskRange; pxPerMinute: number }) {
  return (
    <div className="relative" style={{ height: `${toPx(range.to, range, pxPerMinute)}px` }} aria-hidden>
      {range.hours.map((h) => (
        <div
          key={h.at}
          data-testid="desk-hour"
          className="text-subtle absolute right-2 text-xs tabular-nums leading-none"
          style={{ top: `${toPx(h.at, range, pxPerMinute)}px` }}>
          {h.label}
        </div>
      ))}
    </div>
  );
}
