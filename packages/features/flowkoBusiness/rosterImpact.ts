// Flowko U29b: what a roster save would newly leave outside (S5), shared by the week save, the usual-week save
// and the absence count. Two kinds of impact per member: the changed days whose shifts hit the weekday's
// opening hours (holidays ignored, as the U26 cap), and the holding business bookings newly outside the
// member's shifts: inside the shifts before the change, not inside after it (U29a S3 ruling: newly outside
// only; a booking already outside, past, or on an absent day never counts). New code that takes already-parsed
// values and imports no roster service (progress ledger Ruling R1: roster.ts imports this module, never the
// other way round); settings.ts keeps its own private twin. Only `mirrorBookingsOfMembers` reads the database.
// Dates are "YYYY-MM-DD" in the business time zone; a booking's date is its local start date. Server only.
import {
  resolveMemberDay,
  type ShiftEntry,
  shiftsOutsideOpening,
  todayIn,
  type WeekHours,
  type WeekPlan,
  weekdayOf,
} from "@calcom/lib/flowkoBusiness/roster";
import { type OpeningHours, WEEKDAYS, type Weekday } from "@calcom/lib/flowkoBusiness/schemas";
import { contains, type Interval, subtract } from "@calcom/lib/flowkoSalon";
import { BookingStatus } from "@calcom/prisma/enums";
import type { FlowkoDb } from "./db";

/** The statuses that hold a slot: the same list as bookingDay.ts HOLDING_STATUSES (pinned by a test; that module imports roster.ts, so it cannot be imported here). */
export const HOLDING_BOOKING_STATUSES = [
  BookingStatus.ACCEPTED,
  BookingStatus.PENDING,
  BookingStatus.AWAITING_HOST,
];

type BookingTimes = { startTime: Date; endTime: Date };

const toInterval = (b: BookingTimes): Interval => ({ start: b.startTime.getTime(), end: b.endTime.getTime() });

function sameEntries(a: ShiftEntry[], b: ShiftEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.from === b[i].from && e.to === b[i].to);
}

/** Bookings inside `before` and not inside `after`: the ones a change leaves newly outside. */
export function countNewlyOutside(bookings: Interval[], before: Interval[], after: Interval[]): number {
  return bookings.filter((iv) => contains(before, iv) && !contains(after, iv)).length;
}

/**
 * The holding bookings on each member's mirror (the business bookings, not the worker's private Cal bookings)
 * that end after `now` (and after `range.from`) and start before `range.to`. Every asked member has an entry; a
 * member without a mirror has an empty one. Two queries; `in` only on integer columns (never on a date column).
 */
export async function mirrorBookingsOfMembers(
  db: FlowkoDb,
  memberIds: number[],
  range: { from?: Date; to?: Date },
  now: Date
): Promise<Map<number, Array<{ startTime: Date; endTime: Date }>>> {
  const result = new Map<number, Array<{ startTime: Date; endTime: Date }>>();
  for (const id of memberIds) result.set(id, []);
  if (memberIds.length === 0) return result;

  const mirrors = await db.flowkoWorkerMirror.findMany({
    where: { memberId: { in: memberIds } },
    select: { memberId: true, eventTypeId: true },
  });
  if (mirrors.length === 0) return result;

  const endAfter = range.from && range.from.getTime() > now.getTime() ? range.from : now;
  const bookings = await db.booking.findMany({
    where: {
      eventTypeId: { in: mirrors.map((m) => m.eventTypeId) },
      status: { in: HOLDING_BOOKING_STATUSES },
      endTime: { gt: endAfter },
      ...(range.to ? { startTime: { lt: range.to } } : {}),
    },
    select: { eventTypeId: true, startTime: true, endTime: true },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
  });
  const memberOfEventType = new Map(mirrors.map((m) => [m.eventTypeId, m.memberId]));
  for (const b of bookings) {
    const memberId = b.eventTypeId === null ? undefined : memberOfEventType.get(b.eventTypeId);
    if (memberId !== undefined) result.get(memberId)?.push({ startTime: b.startTime, endTime: b.endTime });
  }
  return result;
}

/** A member's availability on a date: shifts minus time off (an absent day is empty). */
function availabilityOn(
  usualWeek: WeekHours | null,
  planned: ShiftEntry[] | null,
  absent: boolean,
  date: string,
  timeZone: string
): Interval[] {
  const day = resolveMemberDay({ usualWeek, planned, absent }, date, timeZone);
  return subtract(day.shifts, day.timeOff);
}

/**
 * The impact of a week row on one member. A date is changed when it is today or later and its draft day
 * differs from the stored row (a day set back to the usual week is a deleted row, null). `outsideOpening` lists
 * the changed dates with an entry outside the weekday's opening; `bookingsNewlyOutside` counts the bookings
 * starting on a changed date that the stored plan covered and the draft does not.
 */
export function weekRowImpact(input: {
  timeZone: string;
  opening: OpeningHours;
  usualWeek: WeekHours | null;
  stored: Map<string, ShiftEntry[]>;
  absentDates: Set<string>;
  draft: WeekPlan;
  dates: string[];
  today: string;
  bookings: Array<{ startTime: Date; endTime: Date }>;
}): { outsideOpening: string[]; bookingsNewlyOutside: number } {
  const outsideOpening: string[] = [];
  let bookingsNewlyOutside = 0;
  const bookings = input.bookings.map((b) => ({ iv: toInterval(b), date: todayIn(input.timeZone, b.startTime) }));

  for (const date of input.dates) {
    if (date < input.today) continue;
    const weekday = weekdayOf(date);
    const draftDay = input.draft[weekday];
    const storedDay = input.stored.get(date) ?? null;
    const changed =
      draftDay === null || storedDay === null ? draftDay !== storedDay : !sameEntries(draftDay, storedDay);
    if (!changed) continue;

    if (draftDay !== null && shiftsOutsideOpening(draftDay, input.opening[weekday]).length > 0) {
      outsideOpening.push(date);
    }
    const onDate = bookings.filter((b) => b.date === date).map((b) => b.iv);
    if (onDate.length === 0) continue;
    const absent = input.absentDates.has(date);
    const before = availabilityOn(input.usualWeek, storedDay, absent, date, input.timeZone);
    const after = availabilityOn(input.usualWeek, draftDay, absent, date, input.timeZone);
    bookingsNewlyOutside += countNewlyOutside(onDate, before, after);
  }
  return { outsideOpening, bookingsNewlyOutside };
}

/**
 * The impact of a usual-week row on one member. Changed weekdays = those whose entries differ (no usual week =
 * no entries). `outsideOpening` lists the changed weekdays whose new entries hit the opening hours;
 * `bookingsNewlyOutside` counts bookings on future dates of a changed weekday that follow the usual week: not a
 * date with a planned row (`plannedDates`), not a date covered by an absence.
 */
export function usualRowImpact(input: {
  timeZone: string;
  opening: OpeningHours;
  before: WeekHours | null;
  after: WeekHours | null;
  plannedDates: Set<string>;
  absences: Array<{ startDate: string; endDate: string }>;
  today: string;
  bookings: Array<{ startTime: Date; endTime: Date }>;
}): { outsideOpening: Weekday[]; bookingsNewlyOutside: number } {
  const entries = (week: WeekHours | null, wd: Weekday): ShiftEntry[] => (week ? week[wd] : []);
  const changed = WEEKDAYS.filter((wd) => !sameEntries(entries(input.before, wd), entries(input.after, wd)));
  const outsideOpening = changed.filter(
    (wd) => shiftsOutsideOpening(entries(input.after, wd), input.opening[wd]).length > 0
  );

  let bookingsNewlyOutside = 0;
  for (const b of input.bookings) {
    const date = todayIn(input.timeZone, b.startTime);
    if (date < input.today || !changed.includes(weekdayOf(date))) continue;
    if (input.plannedDates.has(date)) continue;
    if (input.absences.some((a) => a.startDate <= date && date <= a.endDate)) continue;
    const before = availabilityOn(input.before, null, false, date, input.timeZone);
    const after = availabilityOn(input.after, null, false, date, input.timeZone);
    bookingsNewlyOutside += countNewlyOutside([toInterval(b)], before, after);
  }
  return { outsideOpening, bookingsNewlyOutside };
}
