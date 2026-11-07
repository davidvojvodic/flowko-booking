// Flowko U24: wall-clock to epoch-ms conversion and the day grid for the salon engine.
// Only import: @calcom/dayjs (utc + timezone plugins) and the Task 1 interval types.
import dayjs from "@calcom/dayjs";

import type { Interval, Ms } from "./intervals";

export type LocalDate = string; // "YYYY-MM-DD"
export type LocalTime = string; // "HH:mm", "24:00" allowed as end of day

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const STEPS = [5, 10, 15, 20, 30, 60];

function assertDate(date: string): void {
  if (!DATE_RE.test(date) || !dayjs(date, "YYYY-MM-DD", true).isValid()) {
    throw new RangeError(`Flowko U24: malformed date "${date}"`);
  }
}

/**
 * Flowko U24: converts a local date + "HH:mm" in an IANA time zone to epoch ms.
 * "24:00" means 00:00 of the next date. Throws RangeError on malformed input.
 * Nonexistent local times (spring gap) map forward; ambiguous ones (autumn) take the
 * second occurrence, so keep opening hours at or after 07:00.
 */
export function wallClockToMs(date: LocalDate, time: LocalTime, timeZone: string): Ms {
  assertDate(date);
  if (!TIME_RE.test(time)) {
    throw new RangeError(`Flowko U24: malformed time "${time}"`);
  }
  let d = date;
  let t = time;
  if (time === "24:00") {
    d = dayjs.utc(date, "YYYY-MM-DD").add(1, "day").format("YYYY-MM-DD");
    t = "00:00";
  }
  const ms = dayjs.tz(`${d} ${t}`, timeZone).valueOf();
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Flowko U24: cannot convert "${date} ${time}" in "${timeZone}"`);
  }
  return ms;
}

/** Flowko U24: the half-open interval [from, to) on a local date. Throws RangeError when to <= from. */
export function localInterval(date: LocalDate, from: LocalTime, to: LocalTime, timeZone: string): Interval {
  const start = wallClockToMs(date, from, timeZone);
  const end = wallClockToMs(date, to, timeZone);
  if (end <= start) {
    throw new RangeError(`Flowko U24: interval end "${to}" must be after start "${from}"`);
  }
  return { start, end };
}

/** Flowko U24: the whole local day [00:00, 24:00); 23 h or 25 h on DST change days. */
export function dayBounds(date: LocalDate, timeZone: string): Interval {
  return localInterval(date, "00:00", "24:00", timeZone);
}

/** Flowko U24: slot starts day.start + k*step minutes, all below day.end. Step must be 5, 10, 15, 20, 30 or 60. */
export function gridStarts(day: Interval, stepMinutes: number): Ms[] {
  if (!STEPS.includes(stepMinutes)) {
    throw new RangeError(`Flowko U24: step ${stepMinutes} not in {${STEPS.join(",")}}`);
  }
  const step = stepMinutes * 60_000;
  const out: Ms[] = [];
  for (let t = day.start; t < day.end; t += step) out.push(t);
  return out;
}
