// Flowko U28: pure, client-safe helpers for the desk calendar (hour axis, bands, tap-to-book, lanes, labels).
// Imports only @calcom/dayjs and @calcom/lib/flowkoSalon. No server code, no prisma.
import dayjs from "@calcom/dayjs";
import { normalize, wallClockToMs, workerFree } from "@calcom/lib/flowkoSalon";
import type { FitProblem, Interval, Ms } from "@calcom/lib/flowkoSalon";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export type DeskStep = { kind: "busy" | "processing"; start: Ms; end: Ms; serviceName: string };
export type BandKind = "closed" | "off_shift" | "shift" | "time_off";

/** 24-hour "HH:mm" wall time in the business time zone. */
export function formatHm(ms: Ms, timeZone: string): string {
  return dayjs(ms).tz(timeZone).format("HH:mm");
}

/**
 * The visible hour axis for one day (R14): the union of `spans` clipped to `day`, floored/ceiled to whole local
 * hours; no span inside the day gives 08:00-18:00 local. `hours` lists every whole local hour in [from, to),
 * so a 23 h day has 23 entries and a 25 h day has 25.
 */
export function hourRange(
  day: Interval,
  timeZone: string,
  spans: Interval[]
): { from: Ms; to: Ms; hours: Array<{ at: Ms; label: string }> } {
  const inside = spans
    .map((s) => ({ start: Math.max(s.start, day.start), end: Math.min(s.end, day.end) }))
    .filter((s) => s.end > s.start);
  let from: Ms;
  let to: Ms;
  if (inside.length === 0) {
    const date = dayjs(day.start).tz(timeZone).format("YYYY-MM-DD");
    from = Math.max(wallClockToMs(date, "08:00", timeZone), day.start);
    to = Math.min(wallClockToMs(date, "18:00", timeZone), day.end);
  } else {
    const lo = Math.min(...inside.map((s) => s.start));
    const hi = Math.max(...inside.map((s) => s.end));
    const floored = dayjs(lo).tz(timeZone).startOf("hour").valueOf();
    const hiFloor = dayjs(hi).tz(timeZone).startOf("hour").valueOf();
    from = Math.max(floored, day.start);
    to = Math.min(hiFloor === hi ? hi : hiFloor + HOUR_MS, day.end);
  }
  const hours: Array<{ at: Ms; label: string }> = [];
  for (let at = from; at < to; at += HOUR_MS) hours.push({ at, label: formatHm(at, timeZone) });
  return { from, to, hours };
}

/** Intervals that may widen the hour axis (R14): opening, shifts, time off, business bookings. Never other busy. */
export function rangeSpans(view: {
  opening: Interval[];
  columns: Array<{ shifts: Interval[]; timeOff: Interval[] }>;
  bookings: Interval[];
}): Interval[] {
  return [...view.opening, ...view.columns.flatMap((c) => [...c.shifts, ...c.timeOff]), ...view.bookings];
}

/** Vertical pixel offset of `ms` from the start of the visible range. */
export function toPx(ms: Ms, range: { from: Ms }, pxPerMinute: number): number {
  return ((ms - range.from) / MINUTE_MS) * pxPerMinute;
}

/**
 * Start for a tap on an empty spot (R10): g = grid floor anchored at day.start; returns the latest free edge e
 * with g < e <= tapMs, else g. A tap just under a colouring that ends at 10:40 therefore gives 10:40, not 10:30.
 */
export function tapToStart(tapMs: Ms, day: Interval, stepMinutes: number, freeEdges: Ms[]): Ms {
  const stepMs = stepMinutes * MINUTE_MS;
  const g = day.start + Math.floor((tapMs - day.start) / stepMs) * stepMs;
  let best = g;
  for (const e of freeEdges) {
    if (e > best && e <= tapMs) best = e;
  }
  return best;
}

/** Starts of the intervals in which the column's worker is free (U24 `workerFree`, `busy` = busy time of every kind). */
export function freeEdgesFor(column: { shifts: Interval[]; timeOff: Interval[]; busy: Interval[] }): Ms[] {
  return workerFree({
    shifts: column.shifts,
    timeOff: column.timeOff,
    bookings: [],
    externalBusy: column.busy,
  }).map((i) => i.start);
}

function overlap(a: Interval[], b: Interval[]): boolean {
  return a.some((x) => b.some((y) => x.start < y.end && y.start < x.end));
}

/**
 * Side-by-side layout (R14): blocks whose busy segments overlap share a connected group; inside a group each
 * block takes the lowest lane no overlapping block holds; `lanes` is the lane count of the group. Processing
 * gaps never count, so a booking inside another's gap keeps lane 0 of 1.
 */
export function laneLayout(
  blocks: Array<{ id: number; busy: Interval[] }>
): Map<number, { lane: number; lanes: number }> {
  const n = blocks.length;
  const parent = blocks.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    return r;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlap(blocks[i].busy, blocks[j].busy)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  const firstStart = (i: number) => (blocks[i].busy.length ? Math.min(...blocks[i].busy.map((b) => b.start)) : 0);
  const out = new Map<number, { lane: number; lanes: number }>();
  groups.forEach((members) => {
    const ordered = [...members].sort((a, b) => firstStart(a) - firstStart(b) || blocks[a].id - blocks[b].id);
    const laneOf = new Map<number, number>();
    let lanes = 1;
    for (const i of ordered) {
      let lane = 0;
      while (ordered.some((j) => laneOf.get(j) === lane && overlap(blocks[i].busy, blocks[j].busy))) lane++;
      laneOf.set(i, lane);
      lanes = Math.max(lanes, lane + 1);
    }
    for (const i of members) out.set(blocks[i].id, { lane: laneOf.get(i) ?? 0, lanes });
  });
  return out;
}

/**
 * Flowko U29e: E6, R11. Lanes for a column with cancelled blocks (each over its whole [start, end]). Blocks that
 * overlap share a group, live and cancelled alike. Inside a group the live blocks keep laneLayout's lanes
 * (lane 0 first); a group without a live block keeps lane 0 empty; the cancelled blocks take the lanes after the
 * live ones (laneLayout among themselves, shifted). So a cancelled block is never in lane 0: the left part of its
 * time stays tappable and books, and a rebook there draws live left, cancelled right. No cancelled block: the
 * answer is laneLayout's.
 */
export function deskLaneLayout(
  live: Array<{ id: number; busy: Interval[] }>,
  cancelled: Array<{ id: number; busy: Interval[] }>
): Map<number, { lane: number; lanes: number }> {
  if (cancelled.length === 0) return laneLayout(live);
  const all = [...live.map((b) => ({ ...b, live: true })), ...cancelled.map((b) => ({ ...b, live: false }))];
  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    return r;
  };
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (overlap(all[i].busy, all[j].busy)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < all.length; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  const out = new Map<number, { lane: number; lanes: number }>();
  groups.forEach((members) => {
    const liveBlocks = members.filter((i) => all[i].live).map((i) => all[i]);
    const cancelledBlocks = members.filter((i) => !all[i].live).map((i) => all[i]);
    const liveLanes = laneLayout(liveBlocks);
    const cancelledLanes = laneLayout(cancelledBlocks);
    let reserved = 1;
    liveLanes.forEach((l) => {
      reserved = Math.max(reserved, l.lanes);
    });
    let extra = 0;
    cancelledLanes.forEach((l) => {
      extra = Math.max(extra, l.lanes);
    });
    const lanes = reserved + extra;
    liveLanes.forEach((l, id) => out.set(id, { lane: l.lane, lanes }));
    cancelledLanes.forEach((l, id) => out.set(id, { lane: reserved + l.lane, lanes }));
  });
  return out;
}

/** Flowko U29f: F2, R8. Tone of one live booking block on the desk: "a" = brand purple, "b" = pale lilac. */
export type BookingTone = "a" | "b";

/** Flowko U29f: F2, R8. Busy steps touch (one ends where the other starts) or overlap. */
function touchesOrOverlaps(a: Interval[], b: Interval[]): boolean {
  return a.some((x) => b.some((y) => x.start <= y.end && y.start <= x.end));
}

/**
 * Flowko U29f: F2, R8 (David's Q1 = touch rule). Tones of the live bookings of one column: walk them in the
 * column's order (start, then id); the first is "a"; each later one takes the opposite tone of the
 * earliest-starting earlier booking whose busy steps touch or overlap its own (equal starts: the lower id),
 * else the opposite of the latest-starting earlier booking. Processing gaps never count. Pass only the
 * bookings the column draws live; cancelled ones neither take nor shift a tone. Known limit: adding, moving or
 * cancelling an earlier booking can flip later ones.
 */
export function bookingTones(
  live: Array<{ id: number; start: Ms; busy: Interval[] }>
): Map<number, BookingTone> {
  const ordered = [...live].sort((a, b) => a.start - b.start || a.id - b.id);
  const out = new Map<number, BookingTone>();
  ordered.forEach((b, i) => {
    if (i === 0) {
      out.set(b.id, "a");
      return;
    }
    const earlier = ordered.slice(0, i);
    const ref = earlier.find((e) => touchesOrOverlaps(e.busy, b.busy)) ?? earlier[i - 1];
    out.set(b.id, out.get(ref.id) === "a" ? "b" : "a");
  });
  return out;
}

function covers(list: Interval[], at: Ms): boolean {
  return list.some((i) => i.start <= at && at < i.end);
}

/**
 * Background of one column (R14), in order, covering `day` without gaps: closed (outside opening) > time_off >
 * shift > off_shift. Adjacent bands of one kind are merged.
 */
export function columnBands(input: {
  day: Interval;
  opening: Interval[];
  shifts: Interval[];
  timeOff: Interval[];
}): Array<{ kind: BandKind; start: Ms; end: Ms }> {
  const { day } = input;
  const opening = normalize(input.opening);
  const shifts = normalize(input.shifts);
  const timeOff = normalize(input.timeOff);
  const cuts = new Set<Ms>([day.start, day.end]);
  for (const i of [...opening, ...shifts, ...timeOff]) {
    if (i.start > day.start && i.start < day.end) cuts.add(i.start);
    if (i.end > day.start && i.end < day.end) cuts.add(i.end);
  }
  const points = Array.from(cuts).sort((a, b) => a - b);
  const out: Array<{ kind: BandKind; start: Ms; end: Ms }> = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const start = points[k];
    const end = points[k + 1];
    let kind: BandKind;
    if (!covers(opening, start)) kind = "closed";
    else if (covers(timeOff, start)) kind = "time_off";
    else if (covers(shifts, start)) kind = "shift";
    else kind = "off_shift";
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.end = end;
    else out.push({ kind, start, end });
  }
  return out;
}

/** The segments a booking block is drawn from; an untrusted step copy (null) is one solid busy segment (U24 E2). */
export function stepSegments(booking: { start: Ms; end: Ms; steps: DeskStep[] | null }): DeskStep[] {
  if (booking.steps && booking.steps.length > 0) return booking.steps;
  return [{ kind: "busy", start: booking.start, end: booking.end, serviceName: "" }];
}

/** i18n key of the override-dialog text for one fit problem. */
export function problemKey(p: FitProblem): string {
  return `flowko_desk_problem_${p.kind}`;
}

/**
 * Digits for a phone search (R11): "041 123" -> "41123" (one leading 0 dropped, so it finds +38641123...),
 * "+386 41 123" -> "38641123". Null when the text has letters or other characters (a name search) or fewer than
 * 3 digits remain.
 */
export function phoneDigitsForSearch(q: string): string | null {
  const text = q.trim();
  if (!/^[\d\s+\-./()]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 3 ? digits : null;
}

/**
 * Flowko U29e: E10.5, R21. Makes a typed text literal inside a LIKE/ILIKE pattern: `\`, `%` and `_` get a leading
 * backslash (Postgres' default escape character). Prisma's `contains` does not escape them, so „ma%k“ or „m_rija“
 * would act as wildcards. Pure, no `u` flag (the trpc build targets ES5).
 */
export function escapeLikeValue(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}
