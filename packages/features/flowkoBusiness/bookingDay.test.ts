// Flowko U27: the booking-day loader (prismock). Business A (owner Olga, login workers Ana and Bor, staff Rok with a
// login, a stranger without a business) and B (owner Zala, worker Bea); hair-salon template services; U26 usual
// weeks (Ana Mon–Fri 07–15, Bor 12–20). Covers customer-independent pieces: step copies, the worker's bookings of
// a day, Google busy (injected), grid rounding, service loading (W5) and the free-starts service.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; bookingDay.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { dayBounds, type Interval, wallClockToMs } from "@calcom/lib/flowkoSalon";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  combinedSteps,
  type GoogleBusy,
  getFreeStarts,
  googleBusyFor,
  loadServicesForWorker,
  loadWorkerBookings,
  roundDownToGrid,
  type StepCopyRow,
  toExistingBooking,
} from "./bookingDay";
import { addLoginMember, createBusiness } from "./business";
import type { FlowkoDb } from "./db";
import type { FlowkoBusinessError } from "./errors";
import { setUsualWeek } from "./roster";

const db = prismock as unknown as FlowkoDb;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-09T06:00:00Z"); // Mon 07:00 in Ljubljana
const DATE = "2026-11-16"; // a Monday
const at = (date: string, time: string) => wallClockToMs(date, time, TZ);
let seq = 0;

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Fixture = {
  a: number;
  b: number;
  users: { olga: number; ana: number; bor: number; rok: number; stranger: number; zala: number; bea: number };
  members: { olga: number; ana: number; bor: number; bea: number };
  servicesA: Record<"mens" | "colouring", number>;
  serviceB: number;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `bd-a-${seq}`,
    templateId: "hair-salon",
  });
  await prismock.flowkoBusiness.update({ where: { id: created.businessId }, data: { openHolidays: [] } });
  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const rok = await makeUser("Rok");
  const stranger = await makeUser("Stranger");
  const anaMember = await addLoginMember(db, created.businessId, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, created.businessId, bor, FlowkoBusinessRole.WORKER);
  await addLoginMember(db, created.businessId, rok, FlowkoBusinessRole.STAFF);

  const zala = await makeUser("Zala");
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `bd-b-${seq}`,
    templateId: "hair-salon",
  });
  await prismock.flowkoBusiness.update({ where: { id: createdB.businessId }, data: { openHolidays: [] } });
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

  const services = await prismock.flowkoService.findMany({
    where: { businessId: created.businessId },
    select: { id: true, name: true },
  });
  const idOf = (name: string) => {
    const s = services.find((x) => x.name === name);
    if (!s) throw new Error(`fixture: service ${name} missing`);
    return s.id;
  };
  const servicesA = { mens: idOf("Moško striženje"), colouring: idOf("Barvanje") };
  // Ana does both; Bor does only the men's cut.
  for (const serviceId of [servicesA.mens, servicesA.colouring]) {
    await prismock.flowkoServiceWorker.create({ data: { serviceId, memberId: anaMember.memberId } });
  }
  await prismock.flowkoServiceWorker.create({
    data: { serviceId: servicesA.mens, memberId: borMember.memberId },
  });

  const usual = (memberId: number, hours: ShiftEntry[]) =>
    setUsualWeek(db, olga, { memberId, usualWeek: week(hours), confirmOutsideOpening: false });
  await usual(anaMember.memberId, [{ from: "07:00", to: "15:00" }]);
  await usual(borMember.memberId, [{ from: "12:00", to: "20:00" }]);

  const serviceB = (
    await prismock.flowkoService.findFirst({
      where: { businessId: createdB.businessId },
      select: { id: true },
    })
  )?.id;
  if (!serviceB) throw new Error("fixture: B has no service");

  return {
    a: created.businessId,
    b: createdB.businessId,
    users: { olga, ana, bor, rok, stranger, zala, bea },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      bea: beaMember.memberId,
    },
    servicesA,
    serviceB,
  };
}

let f: Fixture;
beforeEach(async () => {
  f = await setUp();
});

/** A booking of a user with optional step rows (indexes follow the array). */
async function makeBooking(
  userId: number,
  start: number,
  end: number,
  opts: { status?: BookingStatus; steps?: Array<["busy" | "processing", number, number]> } = {}
): Promise<number> {
  seq += 1;
  const booking = await prismock.booking.create({
    data: {
      uid: `bd-uid-${seq}`,
      title: "t",
      startTime: new Date(start),
      endTime: new Date(end),
      userId,
      status: opts.status ?? BookingStatus.ACCEPTED,
    },
    select: { id: true },
  });
  for (const [index, [kind, s, e]] of (opts.steps ?? []).entries()) {
    await prismock.flowkoBookingStep.create({
      data: {
        bookingId: booking.id,
        index,
        kind,
        startTime: new Date(s),
        endTime: new Date(e),
        serviceName: "x",
      },
    });
  }
  return booking.id;
}

const dayOf = (date: string): Interval => dayBounds(date, TZ);

describe("toExistingBooking", () => {
  const rows: StepCopyRow[] = [
    { index: 0, kind: "busy", startTime: new Date(1_000_000), endTime: new Date(1_900_000) },
    { index: 1, kind: "processing", startTime: new Date(1_900_000), endTime: new Date(4_000_000) },
  ];
  it("maps step rows to PlacedSteps in epoch ms", () => {
    expect(
      toExistingBooking({ startTime: new Date(1_000_000), endTime: new Date(4_000_000), steps: rows })
    ).toEqual({
      start: 1_000_000,
      end: 4_000_000,
      steps: [
        { index: 0, kind: "busy", start: 1_000_000, end: 1_900_000 },
        { index: 1, kind: "processing", start: 1_900_000, end: 4_000_000 },
      ],
    });
  });
  it("a booking without step rows has no steps key (blocks its whole span)", () => {
    const mapped = toExistingBooking({ startTime: new Date(1_000), endTime: new Date(2_000), steps: [] });
    expect(mapped).toEqual({ start: 1_000, end: 2_000 });
    expect("steps" in mapped).toBe(false);
  });
});

describe("loadWorkerBookings", () => {
  const day = dayOf(DATE);
  it("returns the worker's ACCEPTED booking with its ordered steps, not cancelled or foreign ones", async () => {
    const s = at(DATE, "09:00");
    const ids = await makeBooking(f.users.ana, s, at(DATE, "10:40"), {
      steps: [
        ["busy", s, at(DATE, "09:30")],
        ["processing", at(DATE, "09:30"), at(DATE, "10:10")],
        ["busy", at(DATE, "10:10"), at(DATE, "10:40")],
      ],
    });
    await makeBooking(f.users.ana, at(DATE, "11:00"), at(DATE, "11:30"), { status: BookingStatus.CANCELLED });
    await makeBooking(f.users.bor, at(DATE, "09:00"), at(DATE, "09:30"));
    const loaded = await loadWorkerBookings(db, f.users.ana, day);
    expect(loaded).toEqual([
      {
        start: s,
        end: at(DATE, "10:40"),
        steps: [
          { index: 0, kind: "busy", start: s, end: at(DATE, "09:30") },
          { index: 1, kind: "processing", start: at(DATE, "09:30"), end: at(DATE, "10:10") },
          { index: 2, kind: "busy", start: at(DATE, "10:10"), end: at(DATE, "10:40") },
        ],
      },
    ]);
    expect(await loadWorkerBookings(db, f.users.ana, day, ids)).toEqual([]);
  });

  it("includes PENDING and AWAITING_HOST, excludes REJECTED and bookings outside the day", async () => {
    await makeBooking(f.users.ana, at(DATE, "08:00"), at(DATE, "08:30"), { status: BookingStatus.PENDING });
    await makeBooking(f.users.ana, at(DATE, "09:00"), at(DATE, "09:30"), {
      status: BookingStatus.AWAITING_HOST,
    });
    await makeBooking(f.users.ana, at(DATE, "10:00"), at(DATE, "10:30"), { status: BookingStatus.REJECTED });
    await makeBooking(f.users.ana, at("2026-11-17", "08:00"), at("2026-11-17", "08:30"));
    const loaded = await loadWorkerBookings(db, f.users.ana, day);
    expect(loaded.map((b) => b.start)).toEqual([at(DATE, "08:00"), at(DATE, "09:00")]);
  });

  it("a booking from 23:30 the previous day to 00:30 overlaps the day; one ending exactly at 00:00 does not", async () => {
    await makeBooking(f.users.ana, at("2026-11-15", "23:30"), at(DATE, "00:30"));
    await makeBooking(f.users.ana, at("2026-11-15", "23:00"), at(DATE, "00:00"));
    const loaded = await loadWorkerBookings(db, f.users.ana, day);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].end).toBe(at(DATE, "00:30"));
  });
});

describe("googleBusyFor", () => {
  const day = dayOf(DATE);
  it("no calendar credential: no getBusy call, nothing busy", async () => {
    await prismock.credential.create({ data: { type: "zoom_video", key: {}, userId: f.users.ana } });
    const getBusy = vi.fn();
    expect(await googleBusyFor(f.users.ana, day, { getBusy })).toEqual({ busy: [], unavailable: false });
    expect(getBusy).not.toHaveBeenCalled();
  });

  it("a failed fetch makes the whole day busy and unavailable", async () => {
    await prismock.credential.create({ data: { type: "google_calendar", key: {}, userId: f.users.ana } });
    const getBusy = vi.fn().mockResolvedValue({ success: false, data: [] });
    expect(await googleBusyFor(f.users.ana, day, { getBusy })).toEqual({ busy: [day], unavailable: true });
  });

  it("a thrown fetch is treated like a failed one", async () => {
    await prismock.credential.create({ data: { type: "google_calendar", key: {}, userId: f.users.ana } });
    const getBusy = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await googleBusyFor(f.users.ana, day, { getBusy })).toEqual({ busy: [day], unavailable: true });
  });

  it("maps busy dates to epoch ms; asks for the user's own credentials, user-level calendars, mode slots", async () => {
    await prismock.credential.create({ data: { type: "google_calendar", key: {}, userId: f.users.ana } });
    await prismock.credential.create({ data: { type: "google_calendar", key: {}, userId: f.users.bor } });
    await prismock.selectedCalendar.create({
      data: { userId: f.users.ana, integration: "google_calendar", externalId: "ana@example.com" },
    });
    await prismock.selectedCalendar.create({
      data: { userId: f.users.bor, integration: "google_calendar", externalId: "bor@example.com" },
    });
    const start = at(DATE, "10:00");
    const end = at(DATE, "11:00");
    const getBusy = vi.fn().mockResolvedValue({
      success: true,
      data: [{ start: new Date(start).toISOString(), end: new Date(end) }],
    });
    expect(await googleBusyFor(f.users.ana, day, { getBusy })).toEqual({
      busy: [{ start, end }],
      unavailable: false,
    });
    const [credentials, from, to, selected, mode] = getBusy.mock.calls[0];
    expect(credentials.map((c: { userId: number }) => c.userId)).toEqual([f.users.ana]);
    expect(from).toBe(new Date(day.start).toISOString());
    expect(to).toBe(new Date(day.end).toISOString());
    expect(selected.map((c: { externalId: string }) => c.externalId)).toEqual(["ana@example.com"]);
    expect(mode).toBe("slots");
  });
});

describe("roundDownToGrid", () => {
  it("rounds down to the grid anchored at the day's start", () => {
    const day = dayBounds("2026-11-09", TZ);
    expect(roundDownToGrid(new Date("2026-11-09T06:07:00Z"), day, 15)).toBe(at("2026-11-09", "07:00"));
    expect(roundDownToGrid(new Date("2026-11-09T06:15:00Z"), day, 15)).toBe(at("2026-11-09", "07:15"));
    expect(roundDownToGrid(new Date("2026-11-09T06:44:59Z"), day, 30)).toBe(at("2026-11-09", "07:30"));
  });
});

describe("loadServicesForWorker", () => {
  it("returns the services in input order with their steps", async () => {
    const loaded = await loadServicesForWorker(db, f.a, f.members.ana, [
      f.servicesA.colouring,
      f.servicesA.mens,
    ]);
    expect(loaded.map((s) => s.id)).toEqual([f.servicesA.colouring, f.servicesA.mens]);
    expect(loaded.map((s) => s.name)).toEqual(["Barvanje", "Moško striženje"]);
    expect(loaded[0].steps.map((s) => s.kind)).toEqual(["busy", "processing", "busy"]);
  });

  it("refuses another business's service, an unknown id, duplicates, none and more than five as bad_booking", async () => {
    const code = async (ids: number[]) => {
      try {
        await loadServicesForWorker(db, f.a, f.members.ana, ids);
      } catch (error) {
        return (error as FlowkoBusinessError).code;
      }
      return "no error";
    };
    expect(await code([f.serviceB])).toBe("bad_booking");
    expect(await code([f.servicesA.mens, f.serviceB])).toBe("bad_booking");
    expect(await code([999_999])).toBe("bad_booking");
    expect(await code([f.servicesA.mens, f.servicesA.mens])).toBe("bad_booking");
    expect(await code([])).toBe("bad_booking");
    expect(await code([1, 2, 3, 4, 5, 6])).toBe("bad_booking");
  });

  it("a service not assigned to the worker is service_not_assigned", async () => {
    await expect(
      loadServicesForWorker(db, f.a, f.members.bor, [f.servicesA.mens, f.servicesA.colouring])
    ).rejects.toMatchObject({ code: "service_not_assigned" });
  });

  it("combinedSteps concatenates in order and tags each step with its service id", async () => {
    const loaded = await loadServicesForWorker(db, f.a, f.members.ana, [
      f.servicesA.colouring,
      f.servicesA.mens,
    ]);
    const steps = combinedSteps(loaded);
    expect(steps.map((s) => s.serviceRef)).toEqual([
      String(f.servicesA.colouring),
      String(f.servicesA.colouring),
      String(f.servicesA.colouring),
      String(f.servicesA.mens),
    ]);
    expect(steps.map((s) => s.minutes)).toEqual([30, 40, 30, 30]);
    // The stored steps are not mutated.
    expect(loaded[0].steps[0]).not.toHaveProperty("serviceRef");
  });
});

describe("getFreeStarts", () => {
  const noGoogle = async (): Promise<GoogleBusy> => ({ busy: [], unavailable: false });
  const iso = (date: string, time: string) => new Date(at(date, time)).toISOString();

  it("a men's cut: Ana's 09:00 Barvanje blocks her busy time only; Bor starts at 12:00; Rok may call", async () => {
    const start = at(DATE, "09:00");
    await makeBooking(f.users.ana, start, at(DATE, "10:40"), {
      steps: [
        ["busy", start, at(DATE, "09:30")],
        ["processing", at(DATE, "09:30"), at(DATE, "10:10")],
        ["busy", at(DATE, "10:10"), at(DATE, "10:40")],
      ],
    });
    const view = await getFreeStarts(db, f.users.rok, { date: DATE, serviceIds: [f.servicesA.mens] }, NOW, {
      googleBusy: noGoogle,
    });
    expect(view.date).toBe(DATE);
    expect(view.timeZone).toBe(TZ);
    expect(view.slotStepMinutes).toBe(15);
    expect(view.holiday).toBeNull();
    const ana = view.workers.find((w) => w.memberId === f.members.ana);
    const bor = view.workers.find((w) => w.memberId === f.members.bor);
    expect(ana?.displayName).toBe("Ana");
    expect(ana?.starts).toContain(iso(DATE, "09:30"));
    expect(ana?.starts).toContain(iso(DATE, "07:00"));
    for (const t of ["09:00", "09:15", "10:15"]) expect(ana?.starts).not.toContain(iso(DATE, t));
    expect(bor?.starts[0]).toBe(iso(DATE, "12:00"));
    expect(ana?.googleUnavailable).toBe(false);
  });

  it("a worker not assigned to every requested service is absent", async () => {
    const view = await getFreeStarts(
      db,
      f.users.olga,
      { date: DATE, serviceIds: [f.servicesA.mens, f.servicesA.colouring] },
      NOW,
      { googleBusy: noGoogle }
    );
    // The owner performs every template service (U25) but has no usual week; Bor does not do colouring.
    expect(view.workers.map((w) => w.memberId)).toEqual([f.members.olga, f.members.ana]);
    expect(view.workers[0].starts).toEqual([]);
  });

  it("a worker may call it; a stranger and a user of another business are refused, and so is a foreign service", async () => {
    const input = { date: DATE, serviceIds: [f.servicesA.mens] };
    const asWorker = await getFreeStarts(db, f.users.ana, input, NOW, { googleBusy: noGoogle });
    expect(asWorker.workers.map((w) => w.memberId)).toEqual([f.members.olga, f.members.ana, f.members.bor]);
    await expect(
      getFreeStarts(db, f.users.stranger, input, NOW, { googleBusy: noGoogle })
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getFreeStarts(db, f.users.zala, input, NOW, { googleBusy: noGoogle })).rejects.toMatchObject(
      { code: "bad_booking" }
    );
  });

  it("a failing Google fetch marks that worker unavailable with no starts", async () => {
    const googleBusy = async (userId: number, day: Interval): Promise<GoogleBusy> =>
      userId === f.users.bor ? { busy: [day], unavailable: true } : { busy: [], unavailable: false };
    const view = await getFreeStarts(db, f.users.olga, { date: DATE, serviceIds: [f.servicesA.mens] }, NOW, {
      googleBusy,
    });
    const bor = view.workers.find((w) => w.memberId === f.members.bor);
    expect(bor?.googleUnavailable).toBe(true);
    expect(bor?.starts).toEqual([]);
    expect(view.workers.find((w) => w.memberId === f.members.ana)?.googleUnavailable).toBe(false);
  });

  it("Google busy time removes the starts it covers", async () => {
    const googleBusy = async (userId: number): Promise<GoogleBusy> =>
      userId === f.users.ana
        ? { busy: [{ start: at(DATE, "07:00"), end: at(DATE, "08:00") }], unavailable: false }
        : { busy: [], unavailable: false };
    const view = await getFreeStarts(db, f.users.olga, { date: DATE, serviceIds: [f.servicesA.mens] }, NOW, {
      googleBusy,
    });
    const ana = view.workers.find((w) => w.memberId === f.members.ana);
    expect(ana?.starts[0]).toBe(iso(DATE, "08:00"));
  });

  it("starts before now (rounded down to the grid) are not offered; now itself is", async () => {
    const today = "2026-11-09";
    const view = await getFreeStarts(
      db,
      f.users.olga,
      { date: today, serviceIds: [f.servicesA.mens] },
      new Date("2026-11-09T07:07:00Z"),
      {
        googleBusy: noGoogle,
      }
    );
    const ana = view.workers.find((w) => w.memberId === f.members.ana);
    // 07:07Z = 08:07 Ljubljana, rounded down to 08:00.
    expect(ana?.starts[0]).toBe(iso(today, "08:00"));
  });
});
