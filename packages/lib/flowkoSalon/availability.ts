// Flowko U24: free starts and fit explanation for stepped services (rules E1–E6).
// Pure; imports only within packages/lib/flowkoSalon. All times are epoch ms.
import { contains, overlapping, subtract } from "./intervals";
import type { Interval, Ms } from "./intervals";
import { busyIntervals, placeSteps, totalMinutes, validateSteps } from "./steps";
import type { PlacedStep, ServiceStep } from "./steps";
import { gridStarts } from "./time";

const MINUTE_MS = 60_000;

/**
 * An existing booking. Its step copy is trusted only when it is non-empty, starts at `start`,
 * ends at `end` and has at least one busy step; otherwise the booking blocks its whole span (E2).
 */
export type ExistingBooking = { start: Ms; end: Ms; steps?: PlacedStep[] };
export type WorkerDay = {
  shifts: Interval[];
  timeOff: Interval[];
  bookings: ExistingBooking[];
  externalBusy: Interval[];
};
export type DayRules = {
  opening: Interval[];
  slotStepMinutes: number;
  minimumNoticeMinutes: number;
  now: Ms;
  day: Interval;
};
export type FitProblem =
  | { kind: "outside_opening" }
  | { kind: "off_grid" }
  | { kind: "too_soon" }
  | { kind: "outside_shift"; step: number }
  | { kind: "time_off"; step: number; with: Interval }
  | { kind: "overlaps_booking"; step: number; with: Interval }
  | { kind: "overlaps_external"; step: number; with: Interval };

/** True when the booking's step copy matches its span and has a busy step (a moved booking's stale copy does not). */
function trustedSteps(b: ExistingBooking): b is ExistingBooking & { steps: PlacedStep[] } {
  const s = b.steps;
  return (
    s !== undefined &&
    s.length > 0 &&
    s[0].start === b.start &&
    s[s.length - 1].end === b.end &&
    s.some((p) => p.kind === "busy")
  );
}

/** Busy intervals of one booking (E2): its busy steps when the copy is trusted, else its whole span. */
function bookingBusy(b: ExistingBooking): Interval[] {
  return trustedSteps(b) ? busyIntervals(b.steps) : [{ start: b.start, end: b.end }];
}

/**
 * Flowko U24: the worker's free time = shifts − timeOff − every booking's busy time − externalBusy.
 * Opening hours are NOT applied here (E1: processing steps may run outside the worker's time).
 */
export function workerFree(day: WorkerDay): Interval[] {
  return subtract(day.shifts, [...day.timeOff, ...day.bookings.flatMap(bookingBusy), ...day.externalBusy]);
}

type Context = { free: Interval[]; bookingBusy: Interval[]; candidates: Set<Ms> };

/** E3: grid starts anchored at local midnight ∪ starts of free intervals, all inside rules.day. */
function candidateStarts(free: Interval[], rules: DayRules): Ms[] {
  const raw = [...gridStarts(rules.day, rules.slotStepMinutes), ...free.map((i) => i.start)];
  return Array.from(new Set(raw))
    .filter((s) => s >= rules.day.start && s < rules.day.end)
    .sort((a, b) => a - b);
}

function context(day: WorkerDay, rules: DayRules): Context {
  const free = workerFree(day);
  return {
    free,
    // Per booking, never merged across bookings, so each conflict names its own booking's step.
    bookingBusy: day.bookings.flatMap(bookingBusy),
    candidates: new Set(candidateStarts(free, rules)),
  };
}

function explain(day: WorkerDay, steps: ServiceStep[], start: Ms, rules: DayRules, ctx: Context): FitProblem[] {
  const problems: FitProblem[] = [];
  const whole: Interval = { start, end: start + totalMinutes(steps) * MINUTE_MS };
  if (!contains(rules.opening, whole)) problems.push({ kind: "outside_opening" });
  if (!ctx.candidates.has(start)) problems.push({ kind: "off_grid" });
  if (start < rules.now + rules.minimumNoticeMinutes * MINUTE_MS) problems.push({ kind: "too_soon" });

  for (const p of placeSteps(start, steps)) {
    if (p.kind !== "busy") continue;
    const step: Interval = { start: p.start, end: p.end };
    if (contains(ctx.free, step)) continue;
    for (const w of overlapping(day.timeOff, step)) {
      problems.push({ kind: "time_off", step: p.index, with: { start: w.start, end: w.end } });
    }
    for (const w of overlapping(ctx.bookingBusy, step)) {
      problems.push({ kind: "overlaps_booking", step: p.index, with: { start: w.start, end: w.end } });
    }
    for (const w of overlapping(day.externalBusy, step)) {
      problems.push({ kind: "overlaps_external", step: p.index, with: { start: w.start, end: w.end } });
    }
    if (!contains(day.shifts, step)) problems.push({ kind: "outside_shift", step: p.index });
  }
  return problems;
}

/** Invalid steps would otherwise "fit" everywhere (no busy step = nothing to check). */
function assertValidSteps(steps: ServiceStep[]): void {
  const codes = validateSteps(steps);
  if (codes.length > 0) throw new RangeError(`invalid steps: ${codes.join(",")}`);
}

/**
 * Flowko U24: every reason the steps cannot start at `start` for this worker (E6); [] = fits.
 * Order: outside_opening, off_grid, too_soon, then per busy step: time_off, overlaps_booking,
 * overlaps_external, outside_shift. Processing steps need no worker (E1).
 * Throws RangeError("invalid steps: <codes>") when validateSteps(steps) is non-empty.
 */
export function explainFit(day: WorkerDay, steps: ServiceStep[], start: Ms, rules: DayRules): FitProblem[] {
  assertValidSteps(steps);
  return explain(day, steps, start, rules, context(day, rules));
}

/**
 * Flowko U24: candidate starts (E3) inside rules.day where explainFit is [], ascending, unique.
 * Throws RangeError when rules.slotStepMinutes is not 5, 10, 15, 20, 30 or 60, when rules.day is
 * not a finite non-empty interval, or ("invalid steps: <codes>") when validateSteps(steps) is non-empty.
 */
export function freeStarts(day: WorkerDay, steps: ServiceStep[], rules: DayRules): Ms[] {
  assertValidSteps(steps);
  const ctx = context(day, rules);
  // ctx.candidates keeps candidateStarts' ascending insertion order.
  return Array.from(ctx.candidates).filter((s) => explain(day, steps, s, rules, ctx).length === 0);
}
