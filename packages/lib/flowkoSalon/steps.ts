// Flowko U24: service steps for the salon availability engine. A service is an ordered
// list of steps: busy (worker with the client) or processing (client waits, worker free).
// Pure; imports only ./intervals.
import { normalize } from "./intervals";
import type { Interval, Ms } from "./intervals";

const MINUTE_MS = 60_000;

export type StepKind = "busy" | "processing";
/** serviceRef: which catalogue service a step came from (multi-service visits). */
export type ServiceStep = { kind: StepKind; minutes: number; serviceRef?: string };
export type PlacedStep = { index: number; kind: StepKind; start: Ms; end: Ms; serviceRef?: string };

/**
 * Flowko U24: returns error codes for a step list, [] when valid. Codes: "empty",
 * "bad_minutes:<index>" (not an integer >= 5 and a multiple of 5, reported in step order),
 * then "no_busy_step", "starts_with_processing", "ends_with_processing".
 */
export function validateSteps(steps: ServiceStep[]): string[] {
  if (steps.length === 0) return ["empty"];
  const errors: string[] = [];
  steps.forEach((s, i) => {
    if (!Number.isInteger(s.minutes) || s.minutes < 5 || s.minutes % 5 !== 0) errors.push(`bad_minutes:${i}`);
  });
  if (!steps.some((s) => s.kind === "busy")) errors.push("no_busy_step");
  if (steps[0].kind === "processing") errors.push("starts_with_processing");
  if (steps[steps.length - 1].kind === "processing") errors.push("ends_with_processing");
  return errors;
}

/** Flowko U24: total duration of all steps in minutes. */
export function totalMinutes(steps: ServiceStep[]): number {
  return steps.reduce((sum, s) => sum + s.minutes, 0);
}

/** Flowko U24: lays the steps back to back from `start`; this is the per-booking step copy. */
export function placeSteps(start: Ms, steps: ServiceStep[]): PlacedStep[] {
  let cursor = start;
  return steps.map((s, index) => {
    const placed: PlacedStep = { index, kind: s.kind, start: cursor, end: cursor + s.minutes * MINUTE_MS };
    if (s.serviceRef !== undefined) placed.serviceRef = s.serviceRef;
    cursor = placed.end;
    return placed;
  });
}

/** Flowko U24: the busy steps as normalized intervals (touching busy steps merge). */
export function busyIntervals(placed: PlacedStep[]): Interval[] {
  return normalize(placed.filter((p) => p.kind === "busy").map((p) => ({ start: p.start, end: p.end })));
}

/** Flowko U24: a visit is several services back to back with the same worker; returns copied steps. */
export function concatServices(services: ServiceStep[][]): ServiceStep[] {
  return services.flat().map((s) => ({ ...s }));
}
