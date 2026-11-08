// Flowko U28: the now-line (R18: the server's clock). The day answer carries the server's `now`, rounded down to
// the business grid; the line shows the device clock clamped to the slot the server named, carried forward by the
// time since the answer arrived, so a wrong tablet clock is off by at most one slot. It moves every minute.
import { useEffect, useState } from "react";

import { formatHm, toPx } from "@calcom/lib/flowkoBusiness/desk";
import type { Ms } from "@calcom/lib/flowkoSalon";

const MINUTE_MS = 60_000;

/** The desk's current time: `deviceNow` clamped to [server now, server now + one slot], both moved on by the
 *  time elapsed since `receivedAt` (device clock). */
export function deskNowMs(serverNow: Ms, receivedAt: Ms, stepMinutes: number, deviceNow: Ms): Ms {
  const elapsed = Math.max(0, deviceNow - receivedAt);
  const lo = serverNow + elapsed;
  const hi = lo + stepMinutes * MINUTE_MS;
  return Math.min(Math.max(deviceNow, lo), hi);
}

/** Re-renders the caller once a minute (the now-line and the past shading move on). */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), MINUTE_MS);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export function NowLine(props: {
  serverNow: Ms;
  receivedAt: Ms;
  stepMinutes: number;
  range: { from: Ms; to: Ms };
  pxPerMinute: number;
  timeZone: string;
}) {
  useMinuteTick();
  const now = deskNowMs(props.serverNow, props.receivedAt, props.stepMinutes, Date.now());
  if (now < props.range.from || now >= props.range.to) return null;
  return (
    <div
      data-testid="desk-now-line"
      className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-red-500"
      style={{ top: `${toPx(now, props.range, props.pxPerMinute)}px` }}>
      <span className="absolute -top-2.5 left-0 rounded bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white tabular-nums">
        {formatHm(now, props.timeZone)}
      </span>
    </div>
  );
}
