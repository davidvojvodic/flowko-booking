// Flowko U26: roster rules (week dates, day resolution, opening cap, holiday closure).
import { dayBounds } from "@calcom/lib/flowkoSalon";
import { describe, expect, it } from "vitest";

import {
  addDays,
  businessDayRules,
  localDateSchema,
  resolveMemberDay,
  shiftsOutsideOpening,
  todayIn,
  usualWeekForCopy, // Flowko U29d
  weekDates,
  weekdayOf,
  weekHoursSchema,
  weekPlanSchema,
} from "./roster";
import { hairSalonTemplate } from "./templates/hairSalon";

const TZ = "Europe/Ljubljana";
const HOUR = 3_600_000;
const e = (from: string, to: string) => ({ from, to });

const emptyPlan = () => ({
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
});

describe("dates", () => {
  it("weekDates lists Monday to Sunday", () => {
    expect(weekDates("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });

  it("weekDates refuses a day that is not Monday", () => {
    expect(() => weekDates("2026-11-10")).toThrow(RangeError);
    expect(() => weekDates("2026-11-10")).toThrow("week_not_monday");
  });

  it("addDays does calendar arithmetic", () => {
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2027-01-04", -7)).toBe("2026-12-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("weekdayOf", () => {
    expect(weekdayOf("2026-11-09")).toBe("mon");
    expect(weekdayOf("2026-10-25")).toBe("sun");
    expect(weekdayOf("2026-11-07")).toBe("sat");
  });

  it("todayIn gives the business date", () => {
    expect(todayIn(TZ, new Date("2026-11-07T23:30:00Z"))).toBe("2026-11-08");
    expect(todayIn(TZ, new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(todayIn(TZ, new Date("2026-11-07T12:00:00Z"))).toBe("2026-11-07");
    expect(todayIn("UTC", new Date("2026-11-07T23:30:00Z"))).toBe("2026-11-07");
  });
});

describe("resolveMemberDay", () => {
  const usualWeek = {
    mon: [e("07:00", "15:00"), e("16:00", "20:00")],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [e("07:00", "20:00")],
  };

  it("a planned day wins", () => {
    const r = resolveMemberDay(
      { usualWeek, planned: [e("07:00", "15:00")], absent: false },
      "2026-11-09",
      TZ
    );
    expect(r.source).toBe("planned");
    expect(r.entries).toEqual([e("07:00", "15:00")]);
    expect(r.shifts).toHaveLength(1);
    expect(r.timeOff).toEqual([]);
  });

  it("a planned empty day is a day off, not the usual week", () => {
    const r = resolveMemberDay({ usualWeek, planned: [], absent: false }, "2026-11-09", TZ);
    expect(r.source).toBe("planned");
    expect(r.shifts).toEqual([]);
  });

  it("falls back to the usual week", () => {
    const r = resolveMemberDay({ usualWeek, planned: null, absent: false }, "2026-11-09", TZ);
    expect(r.source).toBe("usual");
    expect(r.shifts).toHaveLength(2);
    expect(r.entries).toEqual(usualWeek.mon);
  });

  it("no usual week and no plan is none", () => {
    const r = resolveMemberDay({ usualWeek: null, planned: null, absent: false }, "2026-11-09", TZ);
    expect(r).toEqual({ source: "none", entries: [], shifts: [], timeOff: [] });
  });

  it("an absence adds the whole day as time off and leaves the shifts", () => {
    const r = resolveMemberDay({ usualWeek, planned: null, absent: true }, "2026-11-09", TZ);
    expect(r.timeOff).toEqual([dayBounds("2026-11-09", TZ)]);
    expect(r.shifts).toHaveLength(2);
  });

  it("DST change days: shifts and time off use real hours", () => {
    for (const date of ["2026-10-25", "2026-03-29"]) {
      const r = resolveMemberDay({ usualWeek, planned: null, absent: false }, date, TZ);
      expect(r.shifts).toHaveLength(1);
      expect(r.shifts[0].end - r.shifts[0].start).toBe(13 * HOUR);
    }
    const autumn = resolveMemberDay({ usualWeek, planned: null, absent: true }, "2026-10-25", TZ);
    expect(autumn.timeOff[0].end - autumn.timeOff[0].start).toBe(25 * HOUR);
    const spring = resolveMemberDay({ usualWeek, planned: null, absent: true }, "2026-03-29", TZ);
    expect(spring.timeOff[0].end - spring.timeOff[0].start).toBe(23 * HOUR);
  });
});

describe("shiftsOutsideOpening", () => {
  it("returns entries not inside the opening", () => {
    expect(shiftsOutsideOpening([e("06:00", "13:00"), e("14:00", "20:00")], [e("07:00", "20:00")])).toEqual([
      e("06:00", "13:00"),
    ]);
  });

  it("merges opening entries that touch", () => {
    const opening = [e("07:00", "12:00"), e("12:00", "20:00")];
    expect(shiftsOutsideOpening([e("07:00", "12:00"), e("12:00", "14:00")], opening)).toEqual([]);
    expect(shiftsOutsideOpening([e("11:00", "13:00")], opening)).toEqual([]);
  });

  it("does not merge opening entries with a gap", () => {
    expect(shiftsOutsideOpening([e("11:00", "14:00")], [e("07:00", "12:00"), e("13:00", "20:00")])).toEqual([
      e("11:00", "14:00"),
    ]);
  });

  it("any entry against a closed day is outside", () => {
    const entries = [e("07:00", "09:00"), e("10:00", "24:00")];
    expect(shiftsOutsideOpening(entries, [])).toEqual(entries);
  });

  it("handles 24:00 as end of day", () => {
    expect(shiftsOutsideOpening([e("20:00", "24:00")], [e("07:00", "24:00")])).toEqual([]);
  });
});

describe("businessDayRules", () => {
  const base = {
    openingHours: hairSalonTemplate.openingHours,
    timeZone: TZ,
    slotGridMinutes: 15,
    holidaysClosed: true,
    openHolidays: [] as string[],
  };

  it("closes on a work-free day", () => {
    const r = businessDayRules(base, "2026-12-25");
    expect(r.opening).toEqual([]);
    expect(r.holiday).toEqual({ name: "božič", open: false });
  });

  it("an open-holiday exception keeps the hours", () => {
    const r = businessDayRules({ ...base, openHolidays: ["2026-12-25"] }, "2026-12-25");
    expect(r.opening).toHaveLength(1);
    expect(r.opening[0].end - r.opening[0].start).toBe(13 * HOUR);
    expect(r.holiday).toEqual({ name: "božič", open: true });
  });

  it("holidaysClosed false keeps the hours", () => {
    const r = businessDayRules({ ...base, holidaysClosed: false }, "2026-12-25");
    expect(r.opening).toHaveLength(1);
    expect(r.holiday).toEqual({ name: "božič", open: true });
  });

  it("an ordinary day", () => {
    const r = businessDayRules(base, "2026-11-09");
    expect(r.holiday).toBeNull();
    expect(r.slotStepMinutes).toBe(15);
    expect(r.day).toEqual(dayBounds("2026-11-09", TZ));
    expect(r.opening).toHaveLength(1);
  });

  it("a closed weekday has no opening and no holiday", () => {
    const r = businessDayRules(base, "2026-11-08");
    expect(r.opening).toEqual([]);
    expect(r.holiday).toBeNull();
  });
});

describe("schemas", () => {
  it("localDateSchema", () => {
    expect(localDateSchema.safeParse("2026-11-09").success).toBe(true);
    for (const bad of ["1999-12-27", "2200-01-06", "2026-02-30", "2026-1-09", "x", 5, null]) {
      expect(localDateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("weekHoursSchema is the opening-hours schema", () => {
    expect(weekHoursSchema.safeParse(hairSalonTemplate.openingHours).success).toBe(true);
    expect(weekHoursSchema.safeParse({ ...hairSalonTemplate.openingHours, extra: [] }).success).toBe(false);
  });

  it("weekPlanSchema accepts all null and shifts", () => {
    expect(weekPlanSchema.safeParse(emptyPlan()).success).toBe(true);
    expect(weekPlanSchema.safeParse({ ...emptyPlan(), mon: [e("07:00", "15:00")], tue: [] }).success).toBe(
      true
    );
  });

  it("weekPlanSchema refuses a missing key, an extra key, an early start and overlaps", () => {
    const { sun: _sun, ...missing } = emptyPlan();
    expect(weekPlanSchema.safeParse(missing).success).toBe(false);
    expect(weekPlanSchema.safeParse({ ...emptyPlan(), extra: null }).success).toBe(false);
    const early = weekPlanSchema.safeParse({ ...emptyPlan(), mon: [e("02:30", "05:00")] });
    expect(early.success).toBe(false);
    if (!early.success) expect(early.error.issues.map((i) => i.message)).toContain("before_03_00");
    expect(
      weekPlanSchema.safeParse({ ...emptyPlan(), mon: [e("07:00", "12:00"), e("11:00", "14:00")] }).success
    ).toBe(false);
  });
});

// Flowko U29d (A4): the owner's usual week a brand-new worker gets on accept: as stored when it passes the editor
// rules (weekHoursSchema, at most ROSTER_MAX_SHIFTS_PER_DAY a day, at least one shift), else none (null).
describe("usualWeekForCopy", () => {
  const week = () => ({
    mon: [e("08:00", "12:00"), e("13:00", "16:00")],
    tue: [e("08:00", "16:00")],
    wed: [],
    thu: [e("09:00", "17:00")],
    fri: [e("08:00", "14:00")],
    sat: [],
    sun: [],
  });
  const empty = () => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

  it("answers null for none, the DbNull prismock stores, a bad shape, too many shifts and a week without shifts", () => {
    expect(usualWeekForCopy(null)).toBeNull();
    expect(usualWeekForCopy(undefined)).toBeNull();
    expect(usualWeekForCopy({})).toBeNull();
    // Prisma.DbNull is a class instance with no weekday keys (client-safe code cannot import it).
    expect(usualWeekForCopy(new (class DbNull {})())).toBeNull();
    expect(usualWeekForCopy([])).toBeNull();
    expect(usualWeekForCopy("week")).toBeNull();
    expect(usualWeekForCopy({ ...week(), extra: [] })).toBeNull();
    const { sun: _sun, ...missing } = week();
    expect(usualWeekForCopy(missing)).toBeNull();
    expect(usualWeekForCopy({ ...week(), mon: [e("12:00", "13:00"), e("12:30", "14:00")] })).toBeNull();
    expect(
      usualWeekForCopy({
        ...week(),
        tue: [
          e("06:00", "07:00"),
          e("08:00", "09:00"),
          e("10:00", "11:00"),
          e("12:00", "13:00"),
          e("14:00", "15:00"),
        ],
      })
    ).toBeNull();
    expect(usualWeekForCopy(empty())).toBeNull();
  });

  it("answers a valid week as stored, four shifts on a day included", () => {
    expect(usualWeekForCopy(week())).toEqual(week());
    const four = {
      ...empty(),
      wed: [e("06:00", "07:00"), e("08:00", "09:00"), e("10:00", "11:00"), e("12:00", "13:00")],
    };
    expect(usualWeekForCopy(four)).toEqual(four);
    expect(usualWeekForCopy(hairSalonTemplate.openingHours)).toEqual(hairSalonTemplate.openingHours);
  });
});
