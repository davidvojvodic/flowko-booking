// Flowko U26: the roster services of a business (usual week, week changes, copy, absences, holiday settings),
// with the owner/worker rights of H3: read = any business access; usual week = the owner; week changes, copy
// and absences = mayEditRoster (owner any column member, a worker self, staff never); holiday settings = the
// owner. Every write checks, in this order: access (forbidden) → target member loaded by id from the database
// (missing or another business's = the same forbidden) → right → input (bad_roster / bad_absence /
// week_out_of_range) → opening cap (outside_opening, changed days only, G6). A week write replaces exactly the
// seven dates of the week (G3): deleteMany over the date range, then createMany of the non-null days; the
// compound key and `in` on a date column are never used (prismock compares Dates by reference there). Dates are
// "YYYY-MM-DD" in the business time zone, stored as UTC midnight (@db.Date). Server only.
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import { workFreeDayOn } from "@calcom/lib/flowkoBusiness/holidays";
import {
  addDays,
  businessDayRules,
  localDateSchema,
  type MemberDaySource,
  resolveMemberDay,
  type ShiftEntry,
  shiftsOutsideOpening,
  todayIn,
  type WeekHours,
  type WeekPlan,
  weekdayOf,
  weekHoursSchema,
  weekPlanSchema,
} from "@calcom/lib/flowkoBusiness/roster";
import {
  type OpeningHours,
  openingHoursSchema,
  shiftDaySchema,
  WEEKDAYS,
} from "@calcom/lib/flowkoBusiness/schemas";
import type { Interval, LocalDate } from "@calcom/lib/flowkoSalon";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import {
  type BusinessAccess,
  type MemberRef,
  mayEditRoster,
  mayManageBusiness,
  requireBusinessAccess,
} from "./access";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError, type FlowkoBusinessErrorCode } from "./errors";

/** G7: a week may be written up to its Monday ≤ today + 371 days; absences start and holidays open likewise. */
const WINDOW_DAYS = 371;
/** H2: endDate − startDate ≤ 365 (at most 366 calendar days inclusive), as the FlowkoAbsence CHECK. */
const MAX_ABSENCE_SPAN_DAYS = 365;
const DAY_MS = 86_400_000;
const MAX_INT4 = 2_147_483_647;
const COLUMN_ROLES: FlowkoBusinessRole[] = [FlowkoBusinessRole.OWNER, FlowkoBusinessRole.WORKER];

export type RosterWeekView = {
  businessId: number;
  timeZone: string;
  weekStart: LocalDate;
  holidaysClosed: boolean;
  /** opening = the weekday's opening hours (the cap of G6); holiday.open false = closed that day (H1). */
  days: Array<{ date: LocalDate; opening: ShiftEntry[]; holiday: { name: string; open: boolean } | null }>;
  members: Array<{
    memberId: number;
    displayName: string;
    deskOnly: boolean;
    status: FlowkoMemberStatus;
    usualWeek: WeekHours | null;
    days: Array<{ date: LocalDate; source: MemberDaySource; entries: ShiftEntry[]; absent: boolean }>;
    /** Absences overlapping the week. */
    absences: Array<{ id: number; startDate: LocalDate; endDate: LocalDate }>;
  }>;
  canEditUsualWeek: boolean;
  editableMemberIds: number[];
};

/** U24 engine input of one business day (Task 5): the day rules plus every column worker's shifts and time off. */
export type LoadedBusinessDay = {
  businessId: number;
  date: LocalDate;
  rules: { opening: Interval[]; day: Interval; slotStepMinutes: number };
  holiday: { name: string; open: boolean } | null;
  workers: Array<{
    memberId: number;
    userId: number;
    displayName: string;
    shifts: Interval[];
    timeOff: Interval[];
  }>;
};

type BusinessSettings = {
  timeZone: string;
  openingHours: OpeningHours;
  slotGridMinutes: number;
  holidaysClosed: boolean;
  openHolidays: LocalDate[];
};

function fail(code: FlowkoBusinessErrorCode): never {
  throw new FlowkoBusinessError(code);
}

const toDbDate = (date: LocalDate): Date => new Date(`${date}T00:00:00Z`);
const fromDbDate = (date: Date): LocalDate => date.toISOString().slice(0, 10);

/** A real calendar date in 2000–2199, else `code`. */
function dateOrFail(value: unknown, code: FlowkoBusinessErrorCode): LocalDate {
  const parsed = localDateSchema.safeParse(value);
  if (!parsed.success) fail(code);
  return parsed.data;
}

/** Preflight Ruling 1: a non-Monday or malformed week start is bad_roster. */
function mondayOrFail(value: unknown): LocalDate {
  const date = dateOrFail(value, "bad_roster");
  if (weekdayOf(date) !== "mon") fail("bad_roster");
  return date;
}

function datesOfWeek(monday: LocalDate): LocalDate[] {
  return WEEKDAYS.map((_, i) => addDays(monday, i));
}

function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / DAY_MS);
}

/** G7: Sunday ≥ today and Monday ≤ today + 371, else week_out_of_range. */
function checkWeekWindow(monday: LocalDate, today: LocalDate): void {
  if (addDays(monday, 6) < today || monday > addDays(today, WINDOW_DAYS)) fail("week_out_of_range");
}

/** An object with no own keys: how prismock stores a written Prisma.DbNull (it clones the sentinel to `{}`). */
function isEmptyObject(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && Object.keys(raw).length === 0;
}

/**
 * The stored usual week: SQL NULL = none; Prisma.DbNull and `{}` (the DbNull prismock stores; never written
 * on Postgres, where the services store a full week or SQL NULL) are none too. Any other value that is not a
 * valid week throws (only the services write it, validated).
 */
export function readUsualWeek(raw: unknown): WeekHours | null {
  return raw === null || raw === undefined || raw === Prisma.DbNull || isEmptyObject(raw)
    ? null
    : weekHoursSchema.parse(raw);
}

/** The stored shifts of a roster day (only the services write them, validated; a CHECK keeps them an array). */
function readShifts(raw: unknown): ShiftEntry[] {
  return shiftDaySchema.parse(raw);
}

function sameShifts(a: ShiftEntry[] | null | undefined, b: ShiftEntry[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((entry, i) => entry.from === b[i].from && entry.to === b[i].to);
}

async function loadBusiness(db: FlowkoDb, businessId: number): Promise<BusinessSettings> {
  const business = await db.flowkoBusiness.findUnique({
    where: { id: businessId },
    select: {
      timeZone: true,
      openingHours: true,
      slotGridMinutes: true,
      holidaysClosed: true,
      openHolidays: true,
    },
  });
  if (!business) fail("forbidden");
  return {
    timeZone: business.timeZone,
    openingHours: openingHoursSchema.parse(business.openingHours),
    slotGridMinutes: business.slotGridMinutes,
    holidaysClosed: business.holidaysClosed,
    // Nullable at the SQL level (Task 1): a missing list is no open holidays.
    openHolidays: business.openHolidays ?? [],
  };
}

/**
 * The target member as a MemberRef read from the database (never from input). A malformed, missing or other
 * business's id answers the same forbidden.
 */
async function targetOrFail(
  db: FlowkoDb,
  access: BusinessAccess,
  memberId: number
): Promise<MemberRef & { usualWeek: unknown }> {
  if (!Number.isInteger(memberId) || memberId <= 0 || memberId > MAX_INT4) fail("forbidden");
  const member = await db.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: { id: true, businessId: true, role: true, status: true, usualWeek: true },
  });
  if (!member || member.businessId !== access.businessId) fail("forbidden");
  return {
    memberId: member.id,
    businessId: member.businessId,
    role: member.role,
    status: member.status,
    usualWeek: member.usualWeek,
  };
}

/** G6: refuses entries outside the weekday's opening hours unless confirmed. */
function checkOpeningCap(
  changedDays: Array<{ weekday: keyof OpeningHours; entries: ShiftEntry[] }>,
  openingHours: OpeningHours,
  confirmOutsideOpening: boolean
): void {
  if (confirmOutsideOpening) return;
  for (const { weekday, entries } of changedDays) {
    if (shiftsOutsideOpening(entries, openingHours[weekday]).length > 0) fail("outside_opening");
  }
}

/** Runs a roster write; a unique violation (two writers of one member-week) is roster_conflict, never a 500. */
async function rosterTx<T>(db: FlowkoDb, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await withFlowkoTx(db, fn);
  } catch (e) {
    // Flowko U26 (final review M2): P2002 = unique violation, P2034 = write conflict or deadlock.
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2002" || e.code === "P2034"))
      fail("roster_conflict");
    throw e;
  }
}

/** The member's stored rows on the seven dates, by date. */
async function storedWeek(
  db: FlowkoDb,
  memberId: number,
  dates: LocalDate[]
): Promise<Map<LocalDate, unknown>> {
  const rows = await db.flowkoRosterDay.findMany({
    where: { memberId, date: { gte: toDbDate(dates[0]), lte: toDbDate(dates[6]) } },
    select: { date: true, shifts: true },
  });
  return new Map(rows.map((row) => [fromDbDate(row.date), row.shifts]));
}

/**
 * G3: the seven dates become exactly `days` (a list = a row, null = no row); other dates are not touched.
 * Final review M1: dates before `today` (the business's today) are never changed, neither deleted nor written,
 * so a write to the current week keeps its past days.
 */
async function replaceWeek(
  tx: Prisma.TransactionClient,
  memberId: number,
  dates: LocalDate[],
  days: Array<ShiftEntry[] | null>,
  actorUserId: number,
  today: LocalDate
): Promise<void> {
  const first = dates[0] < today ? today : dates[0];
  if (first <= dates[6]) {
    await tx.flowkoRosterDay.deleteMany({
      where: { memberId, date: { gte: toDbDate(first), lte: toDbDate(dates[6]) } },
    });
  }
  const data = dates.flatMap((date, i) => {
    const shifts = days[i];
    return shifts === null || date < today
      ? []
      : [{ memberId, date: toDbDate(date), shifts, updatedByUserId: actorUserId }];
  });
  if (data.length > 0) await tx.flowkoRosterDay.createMany({ data });
}

/** The week view of the actor's business: any business access may read; any Monday (past included). */
export async function getRosterWeek(
  db: FlowkoDb,
  actorUserId: number,
  weekStart: LocalDate
): Promise<RosterWeekView> {
  const access = await requireBusinessAccess(db, actorUserId);
  const monday = mondayOrFail(weekStart);
  const business = await loadBusiness(db, access.businessId);
  const dates = datesOfWeek(monday);
  const sunday = dates[6];

  // STAFF has no column and is never listed; LOCKED members are listed with their status.
  const members = await db.flowkoBusinessMember.findMany({
    where: { businessId: access.businessId, role: { in: COLUMN_ROLES } },
    select: {
      id: true,
      businessId: true,
      role: true,
      status: true,
      displayName: true,
      usualWeek: true,
      user: { select: { email: true } },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  const memberIds = members.map((m) => m.id);
  const rows =
    memberIds.length === 0
      ? []
      : await db.flowkoRosterDay.findMany({
          where: { memberId: { in: memberIds }, date: { gte: toDbDate(monday), lte: toDbDate(sunday) } },
          select: { memberId: true, date: true, shifts: true },
        });
  const absences =
    memberIds.length === 0
      ? []
      : await db.flowkoAbsence.findMany({
          where: {
            memberId: { in: memberIds },
            startDate: { lte: toDbDate(sunday) },
            endDate: { gte: toDbDate(monday) },
          },
          select: { id: true, memberId: true, startDate: true, endDate: true },
          orderBy: [{ startDate: "asc" }, { id: "asc" }],
        });

  const planned = new Map<string, ShiftEntry[]>();
  for (const row of rows) planned.set(`${row.memberId}|${fromDbDate(row.date)}`, readShifts(row.shifts));

  const dayInput = {
    openingHours: business.openingHours,
    timeZone: business.timeZone,
    slotGridMinutes: business.slotGridMinutes,
    holidaysClosed: business.holidaysClosed,
    openHolidays: business.openHolidays,
  };

  return {
    businessId: access.businessId,
    timeZone: business.timeZone,
    weekStart: monday,
    holidaysClosed: business.holidaysClosed,
    days: dates.map((date) => ({
      date,
      opening: business.openingHours[weekdayOf(date)].map((e) => ({ from: e.from, to: e.to })),
      holiday: businessDayRules(dayInput, date).holiday,
    })),
    members: members.map((m) => {
      const usualWeek = readUsualWeek(m.usualWeek);
      const own = absences
        .filter((a) => a.memberId === m.id)
        .map((a) => ({ id: a.id, startDate: fromDbDate(a.startDate), endDate: fromDbDate(a.endDate) }));
      return {
        memberId: m.id,
        displayName: m.displayName,
        deskOnly: m.user !== null && isFlowkoDeskEmail(m.user.email),
        status: m.status,
        usualWeek,
        days: dates.map((date) => {
          const absent = own.some((a) => a.startDate <= date && date <= a.endDate);
          const day = resolveMemberDay(
            { usualWeek, planned: planned.get(`${m.id}|${date}`) ?? null, absent },
            date,
            business.timeZone
          );
          return { date, source: day.source, entries: day.entries, absent };
        }),
        absences: own,
      };
    }),
    canEditUsualWeek: mayManageBusiness(access),
    editableMemberIds: members
      .filter((m) =>
        mayEditRoster(access, { memberId: m.id, businessId: m.businessId, role: m.role, status: m.status })
      )
      .map((m) => m.id),
  };
}

/**
 * Flowko U26: the roster of one business day as the U24 engine takes it (G8: no actor check; the caller has
 * decided who may see it). ACTIVE owner and worker members in position order; a planned day wins over the usual
 * week, an absence covering the date is whole-day time off. `rules.opening` is [] on a closed work-free day
 * (businessDayRules), while the workers keep their shifts. A column member without a user breaks the U25 CHECK:
 * thrown, never skipped. A missing business answers forbidden.
 */
export async function loadBusinessDay(
  db: FlowkoDb,
  businessId: number,
  date: LocalDate
): Promise<LoadedBusinessDay> {
  const day = dateOrFail(date, "bad_roster");
  const business = await loadBusiness(db, businessId);
  const rules = businessDayRules(business, day);

  const members = await db.flowkoBusinessMember.findMany({
    where: { businessId, role: { in: COLUMN_ROLES }, status: FlowkoMemberStatus.ACTIVE },
    select: { id: true, userId: true, displayName: true, usualWeek: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  const memberIds = members.map((m) => m.id);
  const rows =
    memberIds.length === 0
      ? []
      : await db.flowkoRosterDay.findMany({
          where: { memberId: { in: memberIds }, date: { gte: toDbDate(day), lte: toDbDate(day) } },
          select: { memberId: true, shifts: true },
        });
  const absences =
    memberIds.length === 0
      ? []
      : await db.flowkoAbsence.findMany({
          where: {
            memberId: { in: memberIds },
            startDate: { lte: toDbDate(day) },
            endDate: { gte: toDbDate(day) },
          },
          select: { memberId: true },
        });
  const planned = new Map(rows.map((row) => [row.memberId, readShifts(row.shifts)]));
  const absent = new Set(absences.map((a) => a.memberId));

  return {
    businessId,
    date: day,
    rules: { opening: rules.opening, day: rules.day, slotStepMinutes: rules.slotStepMinutes },
    holiday: rules.holiday,
    workers: members.map((m) => {
      if (m.userId === null) throw new Error("Flowko U26: column member without user");
      const resolved = resolveMemberDay(
        {
          usualWeek: readUsualWeek(m.usualWeek),
          planned: planned.get(m.id) ?? null,
          absent: absent.has(m.id),
        },
        day,
        business.timeZone
      );
      return {
        memberId: m.id,
        userId: m.userId,
        displayName: m.displayName,
        shifts: resolved.shifts,
        timeOff: resolved.timeOff,
      };
    }),
  };
}

/** The owner sets (or clears with null = SQL NULL) a column member's usual week. */
export async function setUsualWeek(
  db: FlowkoDb,
  actorUserId: number,
  input: { memberId: number; usualWeek: WeekHours | null; confirmOutsideOpening: boolean }
): Promise<void> {
  await withFlowkoTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    const target = await targetOrFail(tx, access, input.memberId);
    if (!mayManageBusiness(access) || !mayEditRoster(access, target)) fail("forbidden");

    let usualWeek: WeekHours | null = null;
    if (input.usualWeek !== null) {
      const parsed = weekHoursSchema.safeParse(input.usualWeek);
      if (!parsed.success) fail("bad_roster");
      usualWeek = parsed.data;
    }

    if (usualWeek !== null) {
      const business = await loadBusiness(tx, access.businessId);
      let stored: WeekHours | null = null;
      try {
        stored = readUsualWeek(target.usualWeek);
      } catch {
        stored = null; // an unreadable stored week counts as changed on every day
      }
      const next = usualWeek;
      const changed = WEEKDAYS.filter((wd) => !sameShifts(stored?.[wd], next[wd])).map((wd) => ({
        weekday: wd,
        entries: next[wd],
      }));
      checkOpeningCap(changed, business.openingHours, input.confirmOutsideOpening);
    }

    await tx.flowkoBusinessMember.update({
      where: { id: target.memberId },
      // SQL NULL, never JSON null (the usualWeek CHECK refuses a JSON null).
      data: { usualWeek: usualWeek ?? Prisma.DbNull },
    });
  });
}

/**
 * Writes one member's week (G3): each day a list (stored; [] = day off) or null (row deleted: the usual week
 * applies). The opening cap applies only to days whose entries differ from what is stored.
 */
export async function setRosterWeek(
  db: FlowkoDb,
  actorUserId: number,
  input: { memberId: number; weekStart: LocalDate; days: WeekPlan; confirmOutsideOpening: boolean },
  now: Date
): Promise<void> {
  await rosterTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    const target = await targetOrFail(tx, access, input.memberId);
    if (!mayEditRoster(access, target)) fail("forbidden");

    const monday = mondayOrFail(input.weekStart);
    const parsed = weekPlanSchema.safeParse(input.days);
    if (!parsed.success) fail("bad_roster");
    const plan = parsed.data;
    const business = await loadBusiness(tx, access.businessId);
    const today = todayIn(business.timeZone, now);
    checkWeekWindow(monday, today);

    const dates = datesOfWeek(monday);
    const stored = await storedWeek(tx, target.memberId, dates);
    const changed = WEEKDAYS.flatMap((wd, i) => {
      const entries = plan[wd];
      // Past days of the current week are ignored (M1), so they never ask for the opening-cap confirmation.
      if (entries === null || dates[i] < today) return [];
      const before = shiftDaySchema.safeParse(stored.get(dates[i]));
      return before.success && sameShifts(before.data, entries) ? [] : [{ weekday: wd, entries }];
    });
    checkOpeningCap(changed, business.openingHours, input.confirmOutsideOpening);

    await replaceWeek(
      tx,
      target.memberId,
      dates,
      WEEKDAYS.map((wd) => plan[wd]),
      actorUserId,
      today
    );
  });
}

/**
 * Makes the target week of each member equal to the source week (G5): a planned source day is written, an
 * unplanned one deletes the target row. memberIds null = every ACTIVE column member the actor may edit; an
 * explicit list must be editable id by id (else forbidden, nothing written; LOCKED members are copied). The
 * window applies to the target week only; absences and holidays are not copied; the opening cap is not
 * re-checked.
 */
export async function copyRosterWeek(
  db: FlowkoDb,
  actorUserId: number,
  input: { fromWeekStart: LocalDate; toWeekStart: LocalDate; memberIds: number[] | null },
  now: Date
): Promise<{ copiedMemberIds: number[] }> {
  return rosterTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);

    let targetIds: number[];
    if (input.memberIds === null) {
      if (access.role === FlowkoBusinessRole.STAFF) fail("forbidden");
      const members = await tx.flowkoBusinessMember.findMany({
        where: { businessId: access.businessId, role: { in: COLUMN_ROLES } },
        select: { id: true, businessId: true, role: true, status: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      });
      targetIds = members
        .filter((m) => m.status === FlowkoMemberStatus.ACTIVE)
        .filter((m) =>
          mayEditRoster(access, { memberId: m.id, businessId: m.businessId, role: m.role, status: m.status })
        )
        .map((m) => m.id);
    } else {
      targetIds = [];
      // Final review M2: deduplicated, ascending id order, so concurrent copies lock in the same order.
      for (const memberId of [...new Set(input.memberIds)].sort((a, b) => a - b)) {
        const target = await targetOrFail(tx, access, memberId);
        if (!mayEditRoster(access, target)) fail("forbidden");
        targetIds.push(target.memberId);
      }
    }

    const from = mondayOrFail(input.fromWeekStart);
    const to = mondayOrFail(input.toWeekStart);
    if (from === to) fail("same_week");
    const business = await loadBusiness(tx, access.businessId);
    const today = todayIn(business.timeZone, now);
    checkWeekWindow(to, today);

    const fromDates = datesOfWeek(from);
    const toDates = datesOfWeek(to);
    for (const memberId of targetIds) {
      const source = await storedWeek(tx, memberId, fromDates);
      const days = fromDates.map((date) => (source.has(date) ? readShifts(source.get(date)) : null));
      await replaceWeek(tx, memberId, toDates, days, actorUserId, today);
    }
    return { copiedMemberIds: targetIds };
  });
}

/**
 * Adds a whole-day absence (H2), inclusive: start ≤ end, end − start ≤ 365 days, end ≥ today, start ≤ today +
 * 371 (else bad_absence; the date checks run before any write, so the CHECK never fires). Overlaps are allowed.
 */
export async function addAbsence(
  db: FlowkoDb,
  actorUserId: number,
  input: { memberId: number; startDate: LocalDate; endDate: LocalDate },
  now: Date
): Promise<{ absenceId: number }> {
  return withFlowkoTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    const target = await targetOrFail(tx, access, input.memberId);
    if (!mayEditRoster(access, target)) fail("forbidden");

    const startDate = dateOrFail(input.startDate, "bad_absence");
    const endDate = dateOrFail(input.endDate, "bad_absence");
    if (endDate < startDate || daysBetween(startDate, endDate) > MAX_ABSENCE_SPAN_DAYS) fail("bad_absence");
    const business = await loadBusiness(tx, access.businessId);
    const today = todayIn(business.timeZone, now);
    if (endDate < today || startDate > addDays(today, WINDOW_DAYS)) fail("bad_absence");

    const absence = await tx.flowkoAbsence.create({
      data: {
        memberId: target.memberId,
        startDate: toDbDate(startDate),
        endDate: toDbDate(endDate),
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });
    return { absenceId: absence.id };
  });
}

/** Removes an absence the actor may edit; one that ended before today stays as history (bad_absence). */
export async function removeAbsence(
  db: FlowkoDb,
  actorUserId: number,
  absenceId: number,
  now: Date
): Promise<void> {
  await withFlowkoTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    if (!Number.isInteger(absenceId) || absenceId <= 0 || absenceId > MAX_INT4) fail("forbidden");
    const absence = await tx.flowkoAbsence.findUnique({
      where: { id: absenceId },
      select: { id: true, memberId: true, endDate: true },
    });
    if (!absence) fail("forbidden");
    const target = await targetOrFail(tx, access, absence.memberId);
    if (!mayEditRoster(access, target)) fail("forbidden");

    const business = await loadBusiness(tx, access.businessId);
    if (fromDbDate(absence.endDate) < todayIn(business.timeZone, now)) fail("bad_absence");
    await tx.flowkoAbsence.delete({ where: { id: absence.id } });
  });
}

/** The owner switches the automatic closure on Slovenian work-free days on or off (H1). */
export async function setHolidaysClosed(db: FlowkoDb, actorUserId: number, closed: boolean): Promise<void> {
  await withFlowkoTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    if (!mayManageBusiness(access)) fail("forbidden");
    if (typeof closed !== "boolean") fail("bad_roster");
    await tx.flowkoBusiness.update({ where: { id: access.businessId }, data: { holidaysClosed: closed } });
  });
}

/**
 * The owner opens (or closes again) one work-free day: the date must be a work-free day (not_a_holiday) between
 * today and today + 371 (bad_roster). Every write drops past dates from openHolidays (bounded list).
 */
export async function setHolidayOpen(
  db: FlowkoDb,
  actorUserId: number,
  input: { date: LocalDate; open: boolean },
  now: Date
): Promise<void> {
  await withFlowkoTx(db, async (tx) => {
    const access = await requireBusinessAccess(tx, actorUserId);
    if (!mayManageBusiness(access)) fail("forbidden");

    const date = dateOrFail(input.date, "bad_roster");
    if (typeof input.open !== "boolean") fail("bad_roster");
    const business = await loadBusiness(tx, access.businessId);
    const today = todayIn(business.timeZone, now);
    if (date < today || date > addDays(today, WINDOW_DAYS)) fail("bad_roster");
    if (workFreeDayOn(date) === null) fail("not_a_holiday");

    const kept = business.openHolidays.filter((d) => d >= today && d !== date);
    const next = (input.open ? [...kept, date] : kept).sort();
    await tx.flowkoBusiness.update({ where: { id: access.businessId }, data: { openHolidays: next } });
  });
}
