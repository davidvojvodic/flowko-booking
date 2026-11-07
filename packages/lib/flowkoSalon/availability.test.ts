// Flowko U24: tests for free starts and fit explanation of stepped services (E1–E6). Run with TZ=UTC.
import { describe, expect, it } from "vitest";

import { explainFit, freeStarts, workerFree } from "./availability";
import type { DayRules, WorkerDay } from "./availability";
import type { Ms } from "./intervals";
import { placeSteps } from "./steps";
import type { ServiceStep } from "./steps";
import { dayBounds, gridStarts, localInterval, wallClockToMs } from "./time";

const TZ = "Europe/Ljubljana";
const D = "2026-11-10";
const t = (hm: string): Ms => wallClockToMs(D, hm, TZ);

const C: ServiceStep[] = [
  { kind: "busy", minutes: 30 },
  { kind: "processing", minutes: 40 },
  { kind: "busy", minutes: 30 },
];
const X: ServiceStep[] = [{ kind: "busy", minutes: 30 }];
const X45: ServiceStep[] = [{ kind: "busy", minutes: 45 }];

const rules: DayRules = {
  opening: [localInterval(D, "07:00", "20:00", TZ)],
  slotStepMinutes: 15,
  minimumNoticeMinutes: 0,
  now: t("06:00"),
  day: dayBounds(D, TZ),
};

const worker = (over: Partial<WorkerDay> = {}): WorkerDay => ({
  shifts: [localInterval(D, "07:00", "13:00", TZ)],
  timeOff: [],
  bookings: [],
  externalBusy: [],
  ...over,
});

const ana: WorkerDay = worker({
  bookings: [{ start: t("09:00"), end: t("10:40"), steps: placeSteps(t("09:00"), C) }],
});
const longShift = (over: Partial<WorkerDay> = {}): WorkerDay =>
  worker({ shifts: [localInterval(D, "07:00", "20:00", TZ)], ...over });

/** Reference E3: candidates = grid ∪ workerFree starts inside rules.day, filtered by explainFit. */
function reference(day: WorkerDay, steps: ServiceStep[], r: DayRules): Ms[] {
  const raw = [...gridStarts(r.day, r.slotStepMinutes), ...workerFree(day).map((i) => i.start)];
  const candidates = Array.from(new Set(raw))
    .filter((s) => s >= r.day.start && s < r.day.end)
    .sort((a, b) => a - b);
  return candidates.filter((s) => explainFit(day, steps, s, r).length === 0);
}

describe("availability", () => {
  it("offers starts in the colouring's processing gap and at free-interval starts", () => {
    const starts = freeStarts(ana, X, rules);
    for (const hm of ["09:30", "10:40", "10:45", "12:30"]) expect(starts).toContain(t(hm));
    for (const hm of ["09:15", "09:45", "10:00", "10:30", "12:45"]) expect(starts).not.toContain(t(hm));
    expect(explainFit(ana, X, t("10:40"), rules)).toEqual([]);
    expect(starts).toEqual(reference(ana, X, rules));
  });

  it("explains a start that overlaps the booking's first busy step", () => {
    expect(explainFit(ana, X, t("09:15"), rules)).toEqual([
      { kind: "overlaps_booking", step: 0, with: { start: t("09:00"), end: t("09:30") } },
    ]);
  });

  it("offers no 45-min cut in the 40-min gap", () => {
    const starts = freeStarts(ana, X45, rules);
    expect(starts.filter((s) => s >= t("09:30") && s <= t("10:10"))).toEqual([]);
    expect(starts).toEqual(reference(ana, X45, rules));
  });

  it("reports external busy time", () => {
    const day = { ...ana, externalBusy: [{ start: t("09:40"), end: t("09:50") }] };
    expect(explainFit(day, X, t("09:30"), rules)).toEqual([
      { kind: "overlaps_external", step: 0, with: { start: t("09:40"), end: t("09:50") } },
    ]);
    expect(freeStarts(day, X, rules)).toEqual(reference(day, X, rules));
  });

  it("lets the last busy step not run past the shift or opening", () => {
    expect(explainFit(ana, C, t("11:45"), rules)).toContainEqual({ kind: "outside_shift", step: 2 });
    expect(explainFit(ana, C, t("11:15"), rules)).toEqual([]);
    const late = longShift();
    const problems = explainFit(late, C, t("18:45"), rules);
    expect(problems).toContainEqual({ kind: "outside_opening" });
    expect(problems).toContainEqual({ kind: "outside_shift", step: 2 });
    expect(freeStarts(ana, C, rules)).toEqual(reference(ana, C, rules));
    expect(freeStarts(late, C, rules)).toEqual(reference(late, C, rules));
  });

  it("lets a processing step run across a split-shift break", () => {
    const split = worker({
      shifts: [localInterval(D, "07:00", "11:00", TZ), localInterval(D, "12:00", "15:00", TZ)],
    });
    const S: ServiceStep[] = [
      { kind: "busy", minutes: 30 },
      { kind: "processing", minutes: 60 },
      { kind: "busy", minutes: 30 },
    ];
    expect(explainFit(split, S, t("10:30"), rules)).toEqual([]);
    expect(explainFit(split, S, t("10:45"), rules)).toContainEqual({ kind: "outside_shift", step: 0 });
    expect(freeStarts(split, S, rules)).toEqual(reference(split, S, rules));
  });

  it("offers nothing without a shift", () => {
    const none = worker({ shifts: [] });
    expect(freeStarts(none, X, rules)).toEqual([]);
    expect(explainFit(none, X, t("09:00"), rules)).toContainEqual({ kind: "outside_shift", step: 0 });
    expect(freeStarts(none, X, rules)).toEqual(reference(none, X, rules));
  });

  it("reports time off", () => {
    const day = { ...ana, timeOff: [{ start: t("09:00"), end: t("12:00") }] };
    expect(explainFit(day, X, t("10:00"), rules)).toContainEqual({
      kind: "time_off",
      step: 0,
      with: { start: t("09:00"), end: t("12:00") },
    });
    expect(freeStarts(day, X, rules)).toEqual(reference(day, X, rules));
  });

  it("treats a booking without steps as solid; back to back fits (E2, E5)", () => {
    const solid = worker({ bookings: [{ start: t("08:00"), end: t("08:30") }] });
    expect(explainFit(solid, X, t("08:15"), rules)).toContainEqual({
      kind: "overlaps_booking",
      step: 0,
      with: { start: t("08:00"), end: t("08:30") },
    });
    expect(explainFit(solid, X, t("08:30"), rules)).toEqual([]);
    expect(freeStarts(solid, X, rules)).toEqual(reference(solid, X, rules));
    const empty = worker({ bookings: [{ start: t("08:00"), end: t("08:30"), steps: [] }] });
    expect(explainFit(empty, X, t("08:15"), rules)).toContainEqual({
      kind: "overlaps_booking",
      step: 0,
      with: { start: t("08:00"), end: t("08:30") },
    });
  });

  it("treats a booking as solid when its step copy does not match its span (moved booking)", () => {
    // Booking moved to 11:00–12:40 but its steps still sit at 09:00 (stale copy).
    const moved = worker({ bookings: [{ start: t("11:00"), end: t("12:40"), steps: placeSteps(t("09:00"), C) }] });
    expect(workerFree(moved)).toEqual([
      { start: t("07:00"), end: t("11:00") },
      { start: t("12:40"), end: t("13:00") },
    ]);
    expect(explainFit(moved, X, t("09:00"), rules)).toEqual([]);
    expect(explainFit(moved, X, t("11:45"), rules)).toContainEqual({
      kind: "overlaps_booking",
      step: 0,
      with: { start: t("11:00"), end: t("12:40") },
    });
    expect(freeStarts(moved, X, rules)).toEqual(reference(moved, X, rules));
    // Same start, but the copy ends before the booking (10:40 vs 11:00): solid too.
    const short = worker({ bookings: [{ start: t("09:00"), end: t("11:00"), steps: placeSteps(t("09:00"), C) }] });
    expect(workerFree(short)).toEqual([
      { start: t("07:00"), end: t("09:00") },
      { start: t("11:00"), end: t("13:00") },
    ]);
  });

  it("treats a booking as solid when its step copy has no busy step", () => {
    const P: ServiceStep[] = [{ kind: "processing", minutes: 60 }];
    const idle = worker({ bookings: [{ start: t("09:00"), end: t("10:00"), steps: placeSteps(t("09:00"), P) }] });
    expect(workerFree(idle)).toEqual([
      { start: t("07:00"), end: t("09:00") },
      { start: t("10:00"), end: t("13:00") },
    ]);
    expect(explainFit(idle, X, t("09:15"), rules)).toContainEqual({
      kind: "overlaps_booking",
      step: 0,
      with: { start: t("09:00"), end: t("10:00") },
    });
    expect(freeStarts(idle, X, rules)).toEqual(reference(idle, X, rules));
  });

  it("reports off_grid and too_soon", () => {
    expect(explainFit(ana, X, t("09:31"), rules)).toContainEqual({ kind: "off_grid" });
    const strict: DayRules = { ...rules, minimumNoticeMinutes: 120, now: t("08:00") };
    expect(explainFit(ana, X, t("09:45"), strict)).toContainEqual({ kind: "too_soon" });
    expect(freeStarts(ana, X, strict)).toEqual(reference(ana, X, strict));
  });

  it("reports a start outside rules.day as off_grid", () => {
    expect(explainFit(ana, X, wallClockToMs("2026-11-11", "09:00", TZ), rules)).toContainEqual({ kind: "off_grid" });
  });

  it.each(["2026-10-25", "2026-03-29"])("offers 51 starts on DST day %s", (date) => {
    const day: WorkerDay = {
      shifts: [localInterval(date, "07:00", "20:00", TZ)],
      timeOff: [],
      bookings: [],
      externalBusy: [],
    };
    const r: DayRules = {
      opening: [localInterval(date, "07:00", "20:00", TZ)],
      slotStepMinutes: 15,
      minimumNoticeMinutes: 0,
      now: wallClockToMs(date, "06:00", TZ),
      day: dayBounds(date, TZ),
    };
    const starts = freeStarts(day, X, r);
    expect(starts.length).toBe((13 * 60 - 30) / 15 + 1);
    expect(starts[0]).toBe(wallClockToMs(date, "07:00", TZ));
    expect(starts).toEqual(reference(day, X, r));
  });

  it.each([
    ["no steps", [] as ServiceStep[], "invalid steps: empty"],
    [
      "processing only",
      [{ kind: "processing", minutes: 30 }] as ServiceStep[],
      "invalid steps: no_busy_step,starts_with_processing,ends_with_processing",
    ],
    [
      'kind "Busy"',
      [{ kind: "Busy", minutes: 30 }] as unknown as ServiceStep[],
      "invalid steps: bad_kind:0,no_busy_step",
    ],
  ])("throws RangeError on invalid steps (%s) instead of fitting everywhere", (_name, steps, message) => {
    const none = worker({ shifts: [] });
    expect(() => freeStarts(none, steps, rules)).toThrow(RangeError);
    expect(() => freeStarts(none, steps, rules)).toThrow(message);
    expect(() => freeStarts(longShift(), steps, rules)).toThrow(message);
    expect(() => explainFit(none, steps, t("09:00"), rules)).toThrow(RangeError);
    expect(() => explainFit(none, steps, t("09:00"), rules)).toThrow(message);
  });

  it("workerFree subtracts time off, bookings' busy steps and external busy, not opening", () => {
    expect(workerFree(ana)).toEqual([
      { start: t("07:00"), end: t("09:00") },
      { start: t("09:30"), end: t("10:10") },
      { start: t("10:40"), end: t("13:00") },
    ]);
  });
});
