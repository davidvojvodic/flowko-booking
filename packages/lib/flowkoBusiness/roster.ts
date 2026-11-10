// Flowko U26: the pure roster rules of a business: calendar helpers (week dates, today in the business time
// zone), how one member's day resolves (planned day, else usual week, else none; an absence is time off), the
// check that shifts stay inside the opening hours, and the day rules of the U24 engine including the closure on
// Slovenian work-free days. Pure and client-safe: imports only zod, the pure U24 engine and sibling modules;
// no `node:` import. Dates are "YYYY-MM-DD" in the business time zone; failures throw RangeError with a code.
import type { Interval, LocalDate } from "@calcom/lib/flowkoSalon";
import { dayBounds, localInterval, normalize, contains } from "@calcom/lib/flowkoSalon";
import { z } from "zod";

import { workFreeDayOn } from "./holidays";
import type { OpeningHours, OpeningHoursEntry, Weekday } from "./schemas";
import { WEEKDAYS, openingHoursSchema, openingIntervalsFor, shiftDaySchema } from "./schemas";

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2199;

export type ShiftEntry = OpeningHoursEntry;
export type WeekHours = OpeningHours;
/** The usual week of a member: same shape and rules as the opening hours. */
export const weekHoursSchema: z.ZodType<WeekHours> = openingHoursSchema;

/** One planned week: per weekday a list of shifts (empty = day off) or null (not planned, usual week applies). */
export type WeekPlan = Record<Weekday, ShiftEntry[] | null>;
export const weekPlanSchema: z.ZodType<WeekPlan> = z
  .object({
    mon: shiftDaySchema.nullable(),
    tue: shiftDaySchema.nullable(),
    wed: shiftDaySchema.nullable(),
    thu: shiftDaySchema.nullable(),
    fri: shiftDaySchema.nullable(),
    sat: shiftDaySchema.nullable(),
    sun: shiftDaySchema.nullable(),
  })
  .strict();

/** Parses a date to its UTC midnight, or null when malformed, not a real calendar date or outside 2000-2199. */
function utcMidnight(date: unknown): number | null {
  const match = typeof date === "string" ? DATE_RE.exec(date) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const ms = Date.UTC(year, month - 1, day);
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return ms;
}

function mustParse(date: LocalDate): number {
  const ms = utcMidnight(date);
  if (ms === null) throw new RangeError("bad_date");
  return ms;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function format(ms: number): LocalDate {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** A real calendar date "YYYY-MM-DD" within the supported years 2000-2199. */
export const localDateSchema: z.ZodType<LocalDate> = z
  .string()
  .refine((value) => utcMidnight(value) !== null, { message: "bad_date" });

const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAY_BY_UTC_DAY[new Date(mustParse(date)).getUTCDay()];
}

/** Calendar arithmetic in UTC date space (no time zone, no DST). RangeError on a bad date. */
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) throw new RangeError("bad_days");
  return format(mustParse(date) + days * DAY_MS);
}

/** The seven dates of the week starting on `weekStart`, Monday first. RangeError("week_not_monday") otherwise. */
export function weekDates(weekStart: LocalDate): LocalDate[] {
  if (weekdayOf(weekStart) !== "mon") throw new RangeError("week_not_monday");
  return WEEKDAYS.map((_, i) => addDays(weekStart, i));
}

/** The calendar date of `now` in the business time zone. */
export function todayIn(timeZone: string, now: Date): LocalDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type MemberDaySource = "planned" | "usual" | "none";

/**
 * One member's day: a planned day (even an empty one = day off) wins over the usual week; with neither, source
 * "none" and no shifts. An absence adds the whole local day as time off and leaves the shifts as they are
 * (the availability engine subtracts the time off).
 */
export function resolveMemberDay(
  input: { usualWeek: WeekHours | null; planned: ShiftEntry[] | null; absent: boolean },
  date: LocalDate,
  timeZone: string
): { source: MemberDaySource; entries: ShiftEntry[]; shifts: Interval[]; timeOff: Interval[] } {
  const bounds = dayBounds(date, timeZone); // validates date and zone
  let source: MemberDaySource;
  let entries: ShiftEntry[];
  if (input.planned !== null) {
    source = "planned";
    entries = input.planned;
  } else if (input.usualWeek !== null) {
    source = "usual";
    entries = input.usualWeek[weekdayOf(date)];
  } else {
    source = "none";
    entries = [];
  }
  return {
    source,
    entries: entries.map((entry) => ({ from: entry.from, to: entry.to })),
    shifts: entries.map((entry) => localInterval(date, entry.from, entry.to, timeZone)),
    timeOff: input.absent ? [bounds] : [],
  };
}

/** Minutes since midnight of "HH:mm" or "24:00". */
function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The entries that do not lie inside one interval of the opening entries, where opening entries that touch
 * are merged first (as the U24 `contains`). Compares wall-clock minutes, so it needs no time zone.
 */
export function shiftsOutsideOpening(entries: ShiftEntry[], opening: ShiftEntry[]): ShiftEntry[] {
  const open = normalize(opening.map((o) => ({ start: minutesOf(o.from), end: minutesOf(o.to) })));
  return entries.filter((entry) => !contains(open, { start: minutesOf(entry.from), end: minutesOf(entry.to) }));
}

export type BusinessDayInput = {
  openingHours: OpeningHours;
  timeZone: string;
  slotGridMinutes: number;
  holidaysClosed: boolean;
  openHolidays: LocalDate[];
};

/**
 * The U24 day rules of a business day: opening intervals, the whole local day, the slot step, and the
 * work-free day on the date (null when none). A work-free day closes the business (opening []) when
 * holidaysClosed is on and the date is not in openHolidays.
 */
export function businessDayRules(
  b: BusinessDayInput,
  date: LocalDate
): {
  opening: Interval[];
  day: Interval;
  slotStepMinutes: number;
  holiday: { name: string; open: boolean } | null;
} {
  const day = dayBounds(date, b.timeZone);
  const freeDay = workFreeDayOn(date);
  const open = !(freeDay && b.holidaysClosed && !b.openHolidays.includes(date));
  return {
    opening: open ? openingIntervalsFor(b.openingHours, date, b.timeZone) : [],
    day,
    slotStepMinutes: b.slotGridMinutes,
    holiday: freeDay ? { name: freeDay.name, open } : null,
  };
}

// Flowko U29b: the Urnik editor's save contract (client-safe types; the all-or-nothing savers are server only).
/** One saved row may hold at most this many shifts per day (server check `bad_roster`, mirrored by the editor). */
export const ROSTER_MAX_SHIFTS_PER_DAY = 4;

/**
 * What a save would newly leave outside, per member with something to report: the dates (week save) or weekdays
 * (usual-week save) whose entries hit the opening hours, and the bookings newly outside the member's shifts.
 */
export type RosterWarning = {
  memberId: number;
  outsideOpening: string[]; // LocalDate[] (week) or Weekday[] (usual)
  bookingsNewlyOutside: number;
};

/** The answer of a week or usual-week save: written, or nothing written until the warnings are confirmed. */
export type RosterSaveResult = { status: "saved" } | { status: "needs_confirm"; warnings: RosterWarning[] };

/** The answer of adding an absence: written, or nothing written until the bookings it covers are confirmed. */
export type AddAbsenceResult =
  | { status: "saved"; absenceId: number }
  | { status: "needs_confirm"; bookings: number };
