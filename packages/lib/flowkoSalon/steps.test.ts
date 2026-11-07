// Flowko U24: tests for service steps (busy/processing), placement and validation. Run with TZ=UTC.
import { describe, expect, it } from "vitest";

import { busyIntervals, concatServices, placeSteps, totalMinutes, validateSteps } from "./steps";
import type { ServiceStep } from "./steps";

const MIN = 60_000;
const T = Date.UTC(2026, 10, 9, 9, 0, 0);
const C: ServiceStep[] = [
  { kind: "busy", minutes: 30 },
  { kind: "processing", minutes: 40 },
  { kind: "busy", minutes: 30 },
];

describe("steps", () => {
  it("validates and totals the colouring service", () => {
    expect(validateSteps(C)).toEqual([]);
    expect(totalMinutes(C)).toBe(100);
  });

  it("places steps back to back from T", () => {
    const placed = placeSteps(T, C);
    expect(placed).toEqual([
      { index: 0, kind: "busy", start: T, end: T + 30 * MIN },
      { index: 1, kind: "processing", start: T + 30 * MIN, end: T + 70 * MIN },
      { index: 2, kind: "busy", start: T + 70 * MIN, end: T + 100 * MIN },
    ]);
  });

  it("carries serviceRef onto placed steps only when present", () => {
    const placed = placeSteps(T, [{ kind: "busy", minutes: 30, serviceRef: "cut" }, { kind: "busy", minutes: 5 }]);
    expect(placed[0].serviceRef).toBe("cut");
    expect("serviceRef" in placed[1]).toBe(false);
  });

  it("busyIntervals returns busy steps only", () => {
    expect(busyIntervals(placeSteps(T, C))).toEqual([
      { start: T, end: T + 30 * MIN },
      { start: T + 70 * MIN, end: T + 100 * MIN },
    ]);
  });

  it("validateSteps error codes", () => {
    expect(validateSteps([])).toEqual(["empty"]);
    const p = validateSteps([{ kind: "processing", minutes: 30 }]);
    expect(p).toContain("no_busy_step");
    expect(p).toContain("starts_with_processing");
    expect(validateSteps([{ kind: "busy", minutes: 7 }])).toEqual(["bad_minutes:0"]);
    expect(validateSteps([{ kind: "busy", minutes: 30 }, { kind: "processing", minutes: 10 }])).toEqual([
      "ends_with_processing",
    ]);
  });

  it("rejects non-integer, zero, negative and non-finite minutes in step order", () => {
    expect(
      validateSteps([
        { kind: "busy", minutes: 0 },
        { kind: "busy", minutes: 30 },
        { kind: "busy", minutes: 12.5 },
        { kind: "busy", minutes: -5 },
        { kind: "busy", minutes: Number.NaN },
      ])
    ).toEqual(["bad_minutes:0", "bad_minutes:2", "bad_minutes:3", "bad_minutes:4"]);
  });

  it("concatServices joins services and touching busy steps merge", () => {
    const visit = concatServices([C, [{ kind: "busy", minutes: 30, serviceRef: "cut" }]]);
    expect(visit).toHaveLength(4);
    expect(visit[3].serviceRef).toBe("cut");
    expect(busyIntervals(placeSteps(T, visit))).toEqual([
      { start: T, end: T + 30 * MIN },
      { start: T + 70 * MIN, end: T + 130 * MIN },
    ]);
  });

  it("does not mutate inputs and returns copies", () => {
    const visit = concatServices([C]);
    expect(visit).toEqual(C);
    expect(visit[0]).not.toBe(C[0]);
    expect(concatServices([])).toEqual([]);
  });
});
