// Flowko U29a: the owner's business settings (S2–S5). Read and write the profile the owner runs alone (name,
// phone, address, Reply-To e-mail, opening hours, slot grid, holiday switch, reminder choice, shared-device
// switch); the slug and the time zone are shown, never written here. A save is one transaction: business row
// lock (FOR UPDATE) → stale-form check (settings_changed) → what a narrower opening or the holiday switch would
// newly leave outside (needs_confirm with the counts, unless confirmed; nothing else changes: shifts and bookings
// stay where they are) → business update → rename and reminder choice to every mirror (mirror.ts). Owner only
// (forbidden otherwise). Every computation takes the business time zone and the caller's `now`. Server only.
import {
  businessDayRules,
  shiftsOutsideOpening,
  todayIn,
  weekdayOf,
} from "@calcom/lib/flowkoBusiness/roster";
import {
  type BusinessSettings,
  businessSettingsSchema,
  DEFAULT_REMINDER_OFFSETS,
  type OpeningHours,
  openingHoursSchema,
  shiftDaySchema,
  WEEKDAYS,
  type Weekday,
} from "@calcom/lib/flowkoBusiness/schemas";
import { contains, type Interval, type LocalDate } from "@calcom/lib/flowkoSalon";
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import type { z } from "zod";
import { mayManageBusiness, requireBusinessAccess } from "./access";
import { HOLDING_STATUSES } from "./bookingDay";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError } from "./errors";
import { updateBusinessMirrors } from "./mirror";
import { readUsualWeek } from "./roster";

type Tx = Prisma.TransactionClient;

const COLUMN_ROLES: FlowkoBusinessRole[] = [FlowkoBusinessRole.OWNER, FlowkoBusinessRole.WORKER];

export type BusinessSettingsView = {
  name: string;
  slug: string;
  timeZone: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  openingHours: OpeningHours;
  slotGridMinutes: number;
  holidaysClosed: boolean;
  reminderOffsets: number[];
  sharedDevice: boolean;
  /** The public "call the business" page (/poklicite/<slug>, apps/web/lib/flowko/callPage.ts). */
  callPagePath: string;
  /** The form sends it back as expectedUpdatedAt. */
  updatedAt: Date;
};

export type UpdateBusinessSettingsInput = z.input<typeof businessSettingsSchema> & {
  /** updatedAt of the settings the form loaded; another value stored = settings_changed. */
  expectedUpdatedAt: Date;
  /** true = save although entries would be outside the new opening (the dialog was confirmed). */
  confirm: boolean;
};

export type UpdateBusinessSettingsResult =
  | { status: "saved" }
  | { status: "needs_confirm"; outside: { shifts: number; bookings: number } };

/** The business of an ACTIVE owner, else forbidden. */
async function requireOwner(db: FlowkoDb, userId: number): Promise<number> {
  const access = await requireBusinessAccess(db, userId);
  if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
  return access.businessId;
}

/** A stored list; null/undefined (prismock ignores list defaults; Postgres never stores NULL, CHECK) = [1440]. */
function storedReminderOffsets(value: number[] | null | undefined): number[] {
  return Array.from(value ?? DEFAULT_REMINDER_OFFSETS);
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameDay(a: OpeningHours[Weekday], b: OpeningHours[Weekday]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.from === b[i].from && entry.to === b[i].to);
}

/** S2: the settings of the owner's business. */
export async function getBusinessSettings(db: FlowkoDb, userId: number): Promise<BusinessSettingsView> {
  const businessId = await requireOwner(db, userId);
  const business = await db.flowkoBusiness.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      slug: true,
      timeZone: true,
      phone: true,
      address: true,
      email: true,
      openingHours: true,
      slotGridMinutes: true,
      holidaysClosed: true,
      reminderOffsets: true,
      sharedDevice: true,
      updatedAt: true,
    },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  return {
    name: business.name,
    slug: business.slug,
    timeZone: business.timeZone,
    phone: business.phone,
    address: business.address,
    email: business.email ?? null,
    openingHours: openingHoursSchema.parse(business.openingHours),
    slotGridMinutes: business.slotGridMinutes,
    holidaysClosed: business.holidaysClosed,
    reminderOffsets: storedReminderOffsets(business.reminderOffsets),
    sharedDevice: business.sharedDevice ?? false,
    callPagePath: `/poklicite/${business.slug}`,
    updatedAt: business.updatedAt,
  };
}

type DaySettings = { openingHours: OpeningHours; holidaysClosed: boolean };
type CountContext = {
  businessId: number;
  timeZone: string;
  openHolidays: LocalDate[];
  before: DaySettings;
  after: DaySettings;
  now: Date;
};

/**
 * True when an entry that lay inside the weekday's old opening lies outside its new opening. Entries already
 * outside the old opening (placed there with the override warning) are not counted again (progress ledger Ruling).
 */
function newlyOutside(
  entries: OpeningHours[Weekday],
  before: OpeningHours[Weekday],
  after: OpeningHours[Weekday]
) {
  return shiftsOutsideOpening(entries, after).some(
    (entry) => shiftsOutsideOpening([entry], before).length === 0
  );
}

/**
 * S3 shift days: usual-week days of OWNER/WORKER members (ACTIVE and LOCKED) and their FlowkoRosterDay rows dated
 * today or later, compared by weekday opening (as the roster cap; holidays do not apply), on weekdays whose
 * opening changed. An unreadable stored week or day is skipped (only the roster services write them, validated).
 */
async function countShiftDays(tx: Tx, c: CountContext): Promise<number> {
  const changed = WEEKDAYS.filter((wd) => !sameDay(c.before.openingHours[wd], c.after.openingHours[wd]));
  if (changed.length === 0) return 0;
  const outside = (wd: Weekday, entries: OpeningHours[Weekday]) =>
    newlyOutside(entries, c.before.openingHours[wd], c.after.openingHours[wd]);

  const members = await tx.flowkoBusinessMember.findMany({
    where: { businessId: c.businessId, role: { in: COLUMN_ROLES } },
    select: { id: true, usualWeek: true },
  });
  let count = 0;
  for (const member of members) {
    let usualWeek: OpeningHours | null = null;
    try {
      usualWeek = readUsualWeek(member.usualWeek);
    } catch {
      usualWeek = null;
    }
    if (usualWeek) {
      const week = usualWeek;
      count += changed.filter((wd) => outside(wd, week[wd])).length;
    }
  }

  const memberIds = members.map((m) => m.id);
  if (memberIds.length === 0) return count;
  const today = todayIn(c.timeZone, c.now);
  const rows = await tx.flowkoRosterDay.findMany({
    where: { memberId: { in: memberIds }, date: { gte: new Date(`${today}T00:00:00Z`) } },
    select: { date: true, shifts: true },
  });
  for (const row of rows) {
    const weekday = weekdayOf(row.date.toISOString().slice(0, 10));
    if (!changed.includes(weekday)) continue;
    const shifts = shiftDaySchema.safeParse(row.shifts);
    if (shifts.success && outside(weekday, shifts.data)) count += 1;
  }
  return count;
}

/**
 * S3 bookings: business bookings (on the business's mirrors) in a holding status that end after `now`, whose
 * interval lay inside one opening interval of its local day (the day of its start, holiday closure included)
 * before the change and does not after it. Covers the holiday switch: off → on closes the work-free days that are
 * not in openHolidays.
 */
async function countBookings(tx: Tx, c: CountContext): Promise<number> {
  const mirrors = await tx.flowkoWorkerMirror.findMany({
    where: { businessId: c.businessId },
    select: { eventTypeId: true },
  });
  if (mirrors.length === 0) return 0;
  const bookings = await tx.booking.findMany({
    where: {
      eventTypeId: { in: mirrors.map((m) => m.eventTypeId) },
      status: { in: HOLDING_STATUSES },
      endTime: { gt: c.now },
    },
    select: { startTime: true, endTime: true },
  });

  const openings = new Map<LocalDate, { before: Interval[]; after: Interval[] }>();
  const openingOf = (date: LocalDate) => {
    let opening = openings.get(date);
    if (!opening) {
      const day = (s: DaySettings) =>
        businessDayRules(
          {
            openingHours: s.openingHours,
            holidaysClosed: s.holidaysClosed,
            openHolidays: c.openHolidays,
            timeZone: c.timeZone,
            slotGridMinutes: 15, // not read here: only the opening intervals are used
          },
          date
        ).opening;
      opening = { before: day(c.before), after: day(c.after) };
      openings.set(date, opening);
    }
    return opening;
  };

  let count = 0;
  for (const booking of bookings) {
    const interval = { start: booking.startTime.getTime(), end: booking.endTime.getTime() };
    const opening = openingOf(todayIn(c.timeZone, booking.startTime));
    if (contains(opening.before, interval) && !contains(opening.after, interval)) count += 1;
  }
  return count;
}

/** Valid settings, or bad_profile. */
function parseInput(input: UpdateBusinessSettingsInput): {
  settings: BusinessSettings;
  expectedUpdatedAt: Date;
  confirm: boolean;
} {
  const { expectedUpdatedAt, confirm, ...fields } = input;
  const parsed = businessSettingsSchema.safeParse(fields);
  if (!parsed.success) throw new FlowkoBusinessError("bad_profile");
  if (!(expectedUpdatedAt instanceof Date) || Number.isNaN(expectedUpdatedAt.getTime())) {
    throw new FlowkoBusinessError("bad_profile");
  }
  if (typeof confirm !== "boolean") throw new FlowkoBusinessError("bad_profile");
  return { settings: parsed.data, expectedUpdatedAt, confirm };
}

/**
 * S2–S4: saves the owner's settings. `needs_confirm` (nothing written) when the new opening hours or the holiday
 * switch would newly leave shift days or future business bookings outside the opening, unless `confirm`.
 */
export async function updateBusinessSettings(
  db: FlowkoDb,
  actorUserId: number,
  input: UpdateBusinessSettingsInput,
  now: Date
): Promise<UpdateBusinessSettingsResult> {
  const businessId = await requireOwner(db, actorUserId);
  const { settings, expectedUpdatedAt, confirm } = parseInput(input);

  return withFlowkoTx(db, async (tx) => {
    // S4: the row lock first. A first booking creating a mirror reads the row FOR SHARE (mirror.ts), so it either
    // waits for this save or this save waits for it and then finds its mirror below.
    await tx.$executeRaw`SELECT 1 FROM "FlowkoBusiness" WHERE "id" = ${businessId} FOR UPDATE`;
    const stored = await tx.flowkoBusiness.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        timeZone: true,
        openingHours: true,
        holidaysClosed: true,
        openHolidays: true,
        reminderOffsets: true,
        updatedAt: true,
      },
    });
    if (!stored) throw new FlowkoBusinessError("forbidden");
    if (stored.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      throw new FlowkoBusinessError("settings_changed");
    }

    const before: DaySettings = {
      openingHours: openingHoursSchema.parse(stored.openingHours),
      holidaysClosed: stored.holidaysClosed,
    };
    const after: DaySettings = {
      openingHours: settings.openingHours,
      holidaysClosed: settings.holidaysClosed,
    };
    const openingChanged = WEEKDAYS.some((wd) => !sameDay(before.openingHours[wd], after.openingHours[wd]));
    if (!confirm && (openingChanged || before.holidaysClosed !== after.holidaysClosed)) {
      const context: CountContext = {
        businessId,
        timeZone: stored.timeZone,
        // Nullable at the SQL level (U26): a missing list is no open holidays.
        openHolidays: stored.openHolidays ?? [],
        before,
        after,
        now,
      };
      const outside = {
        shifts: await countShiftDays(tx, context),
        bookings: await countBookings(tx, context),
      };
      if (outside.shifts > 0 || outside.bookings > 0) return { status: "needs_confirm", outside };
    }

    const storedOffsets = storedReminderOffsets(stored.reminderOffsets);
    await tx.flowkoBusiness.update({
      where: { id: businessId },
      data: {
        name: settings.name,
        phone: settings.phone,
        address: settings.address,
        email: settings.email,
        openingHours: settings.openingHours,
        slotGridMinutes: settings.slotGridMinutes,
        holidaysClosed: settings.holidaysClosed,
        reminderOffsets: settings.reminderOffsets,
        sharedDevice: settings.sharedDevice,
        // Written explicitly (Prisma's @updatedAt would use the clock too) and always after the stored value, so
        // two saves in one millisecond still give a form holding the first stamp settings_changed.
        updatedAt: new Date(Math.max(Date.now(), stored.updatedAt.getTime() + 1)),
      },
    });

    await updateBusinessMirrors(tx, businessId, {
      ...(settings.name !== stored.name && { title: settings.name }),
      ...(!sameList(settings.reminderOffsets, storedOffsets) && {
        reminderOffsets: settings.reminderOffsets,
      }),
    });
    return { status: "saved" };
  });
}
