// Flowko U29b: the shared impact rules of a roster save (S5): which changed days hit the opening hours and how
// many bookings a save leaves newly outside the member's shifts ("newly outside" only: already outside, past,
// absent-day and, for the usual week, planned or absent dates count 0). Pure tests on Ana (usual Mon–Fri
// 08–16, business open Mon–Fri 08–20, Europe/Ljubljana) and prismock tests of mirrorBookingsOfMembers.
// NOW = 2026-11-16T07:07:00Z (Mon 08:07 in Ljubljana).
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; rosterImpact.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours, WeekPlan } from "@calcom/lib/flowkoBusiness/roster";
import type { OpeningHours } from "@calcom/lib/flowkoBusiness/schemas";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { describe, expect, it } from "vitest";
import { HOLDING_STATUSES } from "./bookingDay";
import { addLoginMember, createBusiness } from "./business";
import type { FlowkoDb } from "./db";
import { ensureWorkerMirror } from "./mirror";
import {
  countNewlyOutside,
  HOLDING_BOOKING_STATUSES,
  mirrorBookingsOfMembers,
  usualRowImpact,
  weekRowImpact,
} from "./rosterImpact";

const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z");
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const booking = (date: string, from: string, to: string) => ({ startTime: at(date, from), endTime: at(date, to) });
const S = (from: string, to: string): ShiftEntry => ({ from, to });
const OFFICE = [S("08:00", "16:00")];
const OPEN = [S("08:00", "20:00")];
const OPENING: OpeningHours = { mon: OPEN, tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: [], sun: [] };
const ANA: WeekHours = { mon: OFFICE, tue: OFFICE, wed: OFFICE, thu: OFFICE, fri: OFFICE, sat: [], sun: [] };
const DATES = [
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
  "2026-11-22",
];

function plan(days: Partial<WeekPlan> = {}): WeekPlan {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null, ...days };
}

function weekImpact(
  draft: WeekPlan,
  bookings: Array<{ startTime: Date; endTime: Date }>,
  extra: Partial<Parameters<typeof weekRowImpact>[0]> = {}
) {
  return weekRowImpact({
    timeZone: TZ,
    opening: OPENING,
    usualWeek: ANA,
    stored: new Map(),
    absentDates: new Set(),
    draft,
    dates: DATES,
    today: "2026-11-16",
    bookings,
    ...extra,
  });
}

describe("countNewlyOutside", () => {
  const iv = (a: number, b: number) => ({ start: a, end: b });
  it("counts bookings inside before and not inside after", () => {
    const bookings = [iv(10, 20), iv(30, 40), iv(55, 60)];
    expect(countNewlyOutside(bookings, [iv(0, 50)], [iv(0, 25)])).toBe(1);
    expect(countNewlyOutside(bookings, [iv(0, 50)], [iv(0, 50)])).toBe(0);
    expect(countNewlyOutside(bookings, [], [])).toBe(0);
  });
});

describe("HOLDING_BOOKING_STATUSES", () => {
  it("is the booking day's holding list", () => {
    expect([...HOLDING_BOOKING_STATUSES]).toEqual([...HOLDING_STATUSES]);
  });
});

describe("weekRowImpact: bookings newly outside (Review Focus 3)", () => {
  const tue10 = booking("2026-11-17", "10:00", "11:00");

  it("Tue 13–17 leaves a Tue 10:00 booking (inside the usual 08–16) outside: 1", () => {
    expect(weekImpact(plan({ tue: [S("13:00", "17:00")] }), [tue10]).bookingsNewlyOutside).toBe(1);
  });

  it("Tue 09–12 keeps it inside: 0", () => {
    expect(weekImpact(plan({ tue: [S("09:00", "12:00")] }), [tue10]).bookingsNewlyOutside).toBe(0);
  });

  it("a booking already outside the shifts before the change does not count", () => {
    const late = booking("2026-11-17", "17:00", "18:00");
    expect(weekImpact(plan({ tue: [S("13:00", "17:00")] }), [late]).bookingsNewlyOutside).toBe(0);
  });

  it("a changed day before today is not counted", () => {
    const r = weekImpact(plan({ tue: [S("13:00", "17:00")] }), [tue10], { today: "2026-11-18" });
    expect(r.bookingsNewlyOutside).toBe(0);
  });

  it("a booking on an absent day is not counted (empty before and after)", () => {
    const r = weekImpact(plan({ tue: [S("13:00", "17:00")] }), [tue10], {
      absentDates: new Set(["2026-11-17"]),
    });
    expect(r.bookingsNewlyOutside).toBe(0);
  });

  it("an unchanged day is not counted, whatever its bookings", () => {
    const stored = new Map([["2026-11-17", [S("13:00", "17:00")]]]);
    const r = weekImpact(plan({ tue: [S("13:00", "17:00")] }), [tue10], { stored });
    expect(r.bookingsNewlyOutside).toBe(0);
  });

  it("only bookings starting on a changed date count", () => {
    const wed10 = booking("2026-11-18", "10:00", "11:00");
    expect(weekImpact(plan({ tue: [S("13:00", "17:00")] }), [wed10]).bookingsNewlyOutside).toBe(0);
    expect(weekImpact(plan({ tue: [S("13:00", "17:00")] }), [wed10, tue10]).bookingsNewlyOutside).toBe(1);
  });

  it("a planned day off (empty list) leaves the booking outside: 1", () => {
    expect(weekImpact(plan({ tue: [] }), [tue10]).bookingsNewlyOutside).toBe(1);
  });

  it("resetting a stored day to the usual week (null) compares the stored row with the usual shifts", () => {
    const stored = new Map([["2026-11-17", [S("13:00", "17:00")]]]);
    const draft = plan({ tue: null });
    const evening = booking("2026-11-17", "16:30", "17:00"); // inside the stored 13–17, outside the usual 08–16
    expect(weekImpact(draft, [evening], { stored }).bookingsNewlyOutside).toBe(1);
    expect(weekImpact(draft, [booking("2026-11-17", "14:00", "15:00")], { stored }).bookingsNewlyOutside).toBe(0);
  });

  it("DST Sunday 28 Mar 2027: a 10:00 local booking inside the usual 08–16 and outside a planned 13–17 counts 1", () => {
    const dates = [
      "2027-03-22",
      "2027-03-23",
      "2027-03-24",
      "2027-03-25",
      "2027-03-26",
      "2027-03-27",
      "2027-03-28",
    ];
    const usualWeek: WeekHours = { ...ANA, sun: OFFICE };
    const sun10 = booking("2027-03-28", "10:00", "11:00");
    expect(sun10.startTime.toISOString()).toBe("2027-03-28T08:00:00.000Z"); // CEST, UTC+2
    const r = weekImpact(plan({ sun: [S("13:00", "17:00")] }), [sun10], {
      usualWeek,
      dates,
      today: "2027-03-22",
      opening: { ...OPENING, sun: OPEN },
    });
    expect(r.bookingsNewlyOutside).toBe(1);
    expect(
      weekImpact(plan({ sun: [S("09:00", "12:00")] }), [sun10], {
        usualWeek,
        dates,
        today: "2027-03-22",
        opening: { ...OPENING, sun: OPEN },
      }).bookingsNewlyOutside
    ).toBe(0);
  });
});

describe("weekRowImpact: outside the opening hours", () => {
  it("lists a changed Saturday 09–12 when Saturday is closed", () => {
    const r = weekImpact(plan({ sat: [S("09:00", "12:00")] }), []);
    expect(r.outsideOpening).toEqual(["2026-11-21"]);
  });

  it("lists only changed dates from today on", () => {
    const draft = plan({ mon: [S("06:00", "10:00")], sat: [S("09:00", "12:00")], wed: [S("08:00", "12:00")] });
    const r = weekImpact(draft, [], { today: "2026-11-17" });
    expect(r.outsideOpening).toEqual(["2026-11-21"]); // Mon is before today; Wed is inside the opening
  });

  it("does not list an unchanged day, even when its stored shifts are outside the opening", () => {
    const stored = new Map([["2026-11-21", [S("09:00", "12:00")]]]);
    const r = weekImpact(plan({ sat: [S("09:00", "12:00")] }), [], { stored });
    expect(r.outsideOpening).toEqual([]);
  });

  it("lists in date order and ignores days reset to the usual week or set to a day off", () => {
    const draft = plan({ sun: [S("09:00", "10:00")], sat: [S("09:00", "12:00")], tue: [], wed: null });
    expect(weekImpact(draft, []).outsideOpening).toEqual(["2026-11-21", "2026-11-22"]);
  });
});

describe("usualRowImpact", () => {
  const tueAfter: WeekHours = { ...ANA, tue: [S("13:00", "17:00")] };
  const impact = (over: Partial<Parameters<typeof usualRowImpact>[0]> = {}) =>
    usualRowImpact({
      timeZone: TZ,
      opening: OPENING,
      before: ANA,
      after: tueAfter,
      plannedDates: new Set(),
      absences: [],
      today: "2026-11-16",
      bookings: [],
      ...over,
    });

  it("Tue 08–16 → 13–17 counts a future Tue 10:00 booking", () => {
    expect(impact({ bookings: [booking("2026-11-17", "10:00", "11:00")] }).bookingsNewlyOutside).toBe(1);
    expect(impact({ bookings: [booking("2026-12-01", "10:00", "11:00")] }).bookingsNewlyOutside).toBe(1);
  });

  it("skips a Tue with a planned row, a Tue covered by an absence and a past Tue", () => {
    const b = [
      booking("2026-11-17", "10:00", "11:00"), // planned
      booking("2026-11-24", "10:00", "11:00"), // absent
      booking("2026-11-10", "10:00", "11:00"), // past
      booking("2026-12-01", "10:00", "11:00"), // counts
    ];
    const r = impact({
      bookings: b,
      plannedDates: new Set(["2026-11-17"]),
      absences: [{ startDate: "2026-11-23", endDate: "2026-11-25" }],
    });
    expect(r.bookingsNewlyOutside).toBe(1);
  });

  it("ignores unchanged weekdays and bookings already outside the old shifts", () => {
    const b = [booking("2026-11-18", "10:00", "11:00"), booking("2026-11-17", "17:00", "18:00")];
    expect(impact({ bookings: b }).bookingsNewlyOutside).toBe(0);
  });

  it("clearing the usual week (null) leaves every future booking outside", () => {
    const b = [booking("2026-11-17", "10:00", "11:00"), booking("2026-11-18", "10:00", "11:00")];
    expect(impact({ after: null, bookings: b }).bookingsNewlyOutside).toBe(2);
  });

  it("outsideOpening lists changed weekdays whose new entries hit the opening, in week order", () => {
    const after: WeekHours = { ...ANA, sun: [S("09:00", "10:00")], sat: [S("09:00", "12:00")], mon: OFFICE };
    expect(impact({ after }).outsideOpening).toEqual(["sat", "sun"]);
  });

  it("an unchanged weekday outside the opening is not listed", () => {
    const outsideBefore: WeekHours = { ...ANA, sat: [S("09:00", "12:00")] };
    expect(impact({ before: outsideBefore, after: outsideBefore }).outsideOpening).toEqual([]);
  });
});

describe("mirrorBookingsOfMembers", () => {
  const db = prismock as unknown as FlowkoDb;
  const tx = prismock as unknown as Prisma.TransactionClient;
  let seq = 0;

  async function makeUser(name: string): Promise<number> {
    seq += 1;
    const user = await prismock.user.create({
      data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
      select: { id: true },
    });
    return user.id;
  }

  async function bookingOn(
    eventTypeId: number,
    userId: number,
    start: Date,
    end: Date,
    status: BookingStatus = BookingStatus.ACCEPTED
  ) {
    seq += 1;
    await prismock.booking.create({
      data: { uid: `u29b-${seq}`, title: "Termin", startTime: start, endTime: end, eventTypeId, userId, status },
    });
  }

  async function setUp() {
    const olga = await makeUser("Olga");
    const created = await createBusiness(db, {
      ownerUserId: olga,
      name: "Salon A",
      slug: `salon-a-${seq}`,
      templateId: "hair-salon",
    });
    const ana = await makeUser("Ana");
    const bor = await makeUser("Bor");
    const anaMember = await addLoginMember(db, created.businessId, ana, FlowkoBusinessRole.WORKER);
    const borMember = await addLoginMember(db, created.businessId, bor, FlowkoBusinessRole.WORKER);
    const anaMirror = await ensureWorkerMirror(tx, anaMember.memberId);
    const olgaMirror = await ensureWorkerMirror(tx, created.ownerMemberId);
    return { olga, ana, anaMember, borMember, owner: created.ownerMemberId, anaMirror, olgaMirror };
  }

  it("returns only holding bookings on the member's mirror that end after now", async () => {
    const x = await setUp();
    await bookingOn(x.anaMirror.eventTypeId, x.ana, at("2026-11-17", "10:00"), at("2026-11-17", "11:00"));
    await bookingOn(x.anaMirror.eventTypeId, x.ana, at("2026-11-17", "12:00"), at("2026-11-17", "13:00"), BookingStatus.PENDING);
    await bookingOn(x.anaMirror.eventTypeId, x.ana, at("2026-11-17", "14:00"), at("2026-11-17", "15:00"), BookingStatus.CANCELLED);
    await bookingOn(x.anaMirror.eventTypeId, x.ana, at("2026-11-16", "07:00"), at("2026-11-16", "07:30")); // ended before NOW
    await bookingOn(x.olgaMirror.eventTypeId, x.olga, at("2026-11-17", "10:00"), at("2026-11-17", "11:00")); // another member
    const privateType = await prismock.eventType.create({
      data: { title: "Zasebno", slug: "zasebno", length: 30, userId: x.ana },
    });
    await bookingOn(privateType.id, x.ana, at("2026-11-17", "16:00"), at("2026-11-17", "17:00")); // private Cal booking

    const result = await mirrorBookingsOfMembers(db, [x.anaMember.memberId], {}, NOW);
    expect(result.get(x.anaMember.memberId)).toEqual([
      { startTime: at("2026-11-17", "10:00"), endTime: at("2026-11-17", "11:00") },
      { startTime: at("2026-11-17", "12:00"), endTime: at("2026-11-17", "13:00") },
    ]);
  });

  it("a member without a mirror has no bookings; each asked member has an entry", async () => {
    const x = await setUp();
    await bookingOn(x.anaMirror.eventTypeId, x.ana, at("2026-11-17", "10:00"), at("2026-11-17", "11:00"));
    const result = await mirrorBookingsOfMembers(db, [x.anaMember.memberId, x.borMember.memberId], {}, NOW);
    expect(result.get(x.borMember.memberId)).toEqual([]);
    expect(result.get(x.anaMember.memberId)).toHaveLength(1);
    expect((await mirrorBookingsOfMembers(db, [], {}, NOW)).size).toBe(0);
  });

  it("the range keeps bookings ending after `from` and starting before `to`", async () => {
    const x = await setUp();
    const m = x.anaMirror.eventTypeId;
    await bookingOn(m, x.ana, at("2026-11-17", "10:00"), at("2026-11-17", "11:00"));
    await bookingOn(m, x.ana, at("2026-11-24", "10:00"), at("2026-11-24", "11:00"));
    await bookingOn(m, x.ana, at("2026-12-01", "10:00"), at("2026-12-01", "11:00"));
    const result = await mirrorBookingsOfMembers(
      db,
      [x.anaMember.memberId],
      { from: at("2026-11-23", "00:00"), to: at("2026-11-30", "00:00") },
      NOW
    );
    expect(result.get(x.anaMember.memberId)).toEqual([
      { startTime: at("2026-11-24", "10:00"), endTime: at("2026-11-24", "11:00") },
    ]);
  });
});
