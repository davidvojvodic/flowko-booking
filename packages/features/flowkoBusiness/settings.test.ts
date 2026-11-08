// Flowko U29a: the owner's business settings service on prismock. Business A (owner Olga, workers Ana and Dan
// (LOCKED), staff Rok with a login; hair-salon template: Mon–Fri 07–20, Sat 07–13) and B (owner Zala, worker Bea).
// NOW = 2026-11-16T07:07:00Z (Mon 08:07 in Ljubljana). Covers S2 (read, owner only, validation, stale form →
// settings_changed), S3 (what a narrower opening or the holiday switch would leave outside → needs_confirm with
// the counts, nothing changed), S4 (row lock first; rename and reminder choice reach the mirrors). Prismock
// ignores $executeRaw/$queryRaw and rollbacks: the row lock and the cron query are proven on Postgres in
// settings.integration-test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; settings.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { OpeningHours } from "@calcom/lib/flowkoBusiness/schemas";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, createBusiness } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { getBusinessSettings, type UpdateBusinessSettingsInput, updateBusinessSettings } from "./settings";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const STAMP = new Date("2026-11-10T10:00:00.000Z");
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const WEEKDAY = [{ from: "07:00", to: "20:00" }];
const TEMPLATE_HOURS: OpeningHours = {
  mon: WEEKDAY,
  tue: WEEKDAY,
  wed: WEEKDAY,
  thu: WEEKDAY,
  fri: WEEKDAY,
  sat: [{ from: "07:00", to: "13:00" }],
  sun: [],
};
const MONDAY_FROM_8: OpeningHours = { ...TEMPLATE_HOURS, mon: [{ from: "08:00", to: "20:00" }] };
const EARLY_WEEK = {
  mon: [{ from: "07:00", to: "15:00" }],
  tue: [{ from: "07:00", to: "15:00" }],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

let seq = 0;
async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Who = "olga" | "ana" | "dan" | "rok" | "zala" | "bea";
type Fixture = {
  a: number;
  b: number;
  aSlug: string;
  users: Record<Who, number>;
  members: Record<Who, number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const aSlug = `salon-a-${seq}`;
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: aSlug,
    templateId: "hair-salon",
    phone: "01 234 56 78",
    address: "Glavna ulica 1, Ljubljana",
  });
  const a = created.businessId;
  // Prismock ignores list defaults and @updatedAt (test-only).
  await prismock.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [], updatedAt: STAMP } });
  const ana = await makeUser("Ana");
  const dan = await makeUser("Dan");
  const rok = await makeUser("Rok");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const danMember = await addLoginMember(db, a, dan, FlowkoBusinessRole.WORKER);
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  await prismock.user.update({ where: { id: dan }, data: { locked: true } });

  const zala = await makeUser("Zala");
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `salon-b-${seq}`,
    templateId: "hair-salon",
    phone: "02 345 67 89",
  });
  await prismock.flowkoBusiness.update({
    where: { id: createdB.businessId },
    data: { openHolidays: [], updatedAt: STAMP },
  });
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

  return {
    a,
    b: createdB.businessId,
    aSlug,
    users: { olga, ana, dan, rok, zala, bea },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      dan: danMember.memberId,
      rok: rokMember.memberId,
      zala: createdB.ownerMemberId,
      bea: beaMember.memberId,
    },
  };
}

/** "ok" or the FlowkoBusinessError code; any other error fails the test. */
async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (e) {
    if (e instanceof FlowkoBusinessError) {
      expect(e.message).toBe(e.code);
      return e.code;
    }
    throw e;
  }
}

let f: Fixture;

/** Business A's current values as the form would send them back. */
function input(over: Partial<UpdateBusinessSettingsInput> = {}): UpdateBusinessSettingsInput {
  return {
    name: "Salon A",
    phone: "01 234 56 78",
    address: "Glavna ulica 1, Ljubljana",
    email: null,
    openingHours: TEMPLATE_HOURS,
    slotGridMinutes: 15,
    holidaysClosed: true,
    reminderOffsets: [1440],
    sharedDevice: false,
    expectedUpdatedAt: STAMP,
    confirm: false,
    ...over,
  };
}

const save = (over: Partial<UpdateBusinessSettingsInput> = {}, userId = f.users.olga) =>
  updateBusinessSettings(db, userId, input(over), NOW);

async function businessRow(id: number) {
  return prismock.flowkoBusiness.findUnique({ where: { id } });
}

let seqBooking = 0;
async function bookingOn(
  eventTypeId: number,
  userId: number,
  start: Date,
  end: Date,
  status: BookingStatus = BookingStatus.ACCEPTED
): Promise<number> {
  seqBooking += 1;
  const booking = await prismock.booking.create({
    data: {
      uid: `u29a-${seqBooking}`,
      title: "Termin",
      startTime: start,
      endTime: end,
      eventTypeId,
      userId,
      status,
    },
    select: { id: true },
  });
  return booking.id;
}

async function eventTypeOf(id: number) {
  const eventType = await prismock.eventType.findUnique({ where: { id } });
  if (!eventType) throw new Error("fixture: event type missing");
  return eventType;
}

beforeEach(async () => {
  f = await setUp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getBusinessSettings (S2)", () => {
  it("the owner reads every setting of their own business", async () => {
    expect(await getBusinessSettings(db, f.users.olga)).toEqual({
      name: "Salon A",
      slug: f.aSlug,
      timeZone: TZ,
      phone: "01 234 56 78",
      address: "Glavna ulica 1, Ljubljana",
      email: null,
      openingHours: TEMPLATE_HOURS,
      slotGridMinutes: 15,
      holidaysClosed: true,
      reminderOffsets: [1440],
      sharedDevice: false,
      callPagePath: `/poklicite/${f.aSlug}`,
      updatedAt: STAMP,
    });
    expect((await getBusinessSettings(db, f.users.zala)).name).toBe("Salon B");
  });

  it("a business without a stored reminder list (prismock) reads the 24-hour default", async () => {
    const row = await businessRow(f.a);
    (row as { reminderOffsets: unknown }).reminderOffsets = null;
    vi.spyOn(prismock.flowkoBusiness, "findUnique").mockResolvedValueOnce(row as never);
    expect((await getBusinessSettings(db, f.users.olga)).reminderOffsets).toEqual([1440]);
  });

  it("a worker, a staff member, a locked worker and a user in no business: forbidden", async () => {
    const stranger = await makeUser("Tujec");
    for (const userId of [f.users.ana, f.users.rok, f.users.dan, f.users.bea, stranger]) {
      expect(await outcome(getBusinessSettings(db, userId))).toBe("forbidden");
    }
  });
});

describe("updateBusinessSettings: rights and validation (S2)", () => {
  it("a worker, a staff member, a locked worker, another business's owner and a stranger: forbidden, nothing written", async () => {
    const stranger = await makeUser("Tujec");
    for (const userId of [f.users.ana, f.users.rok, f.users.dan, f.users.bea, stranger]) {
      expect(await outcome(save({ name: "Ukradeno" }, userId))).toBe("forbidden");
    }
    expect((await businessRow(f.a))?.name).toBe("Salon A");
    // Zala's save writes only her own business, whatever the form says.
    expect(
      await outcome(
        updateBusinessSettings(db, f.users.zala, input({ name: "Salon B2", phone: "02 345 67 89" }), NOW)
      )
    ).toBe("ok");
    expect((await businessRow(f.a))?.name).toBe("Salon A");
    expect((await businessRow(f.b))?.name).toBe("Salon B2");
  });

  it.each([
    ["a missing phone", { phone: "" }],
    ["a desk placeholder e-mail", { email: "x@flowko.invalid" }],
    ["a phone placeholder e-mail", { email: "0401234@sms.cal.com" }],
    [
      "a week with no open day",
      { openingHours: { ...TEMPLATE_HOURS, mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } },
    ],
    ["a name with a line break", { name: "Salon\nA" }],
    ["an address with a carriage return", { address: "Glavna\r1" }],
    ["reminder offsets [60]", { reminderOffsets: [60] }],
    ["a slot grid of 7", { slotGridMinutes: 7 }],
    ["an invalid expectedUpdatedAt", { expectedUpdatedAt: new Date("nope") }],
    ["a non-boolean confirm", { confirm: "yes" as unknown as boolean }],
  ])("%s: bad_profile, nothing written", async (_label, over) => {
    expect(await outcome(save(over as Partial<UpdateBusinessSettingsInput>))).toBe("bad_profile");
    const row = await businessRow(f.a);
    expect(row?.name).toBe("Salon A");
    expect(row?.updatedAt).toEqual(STAMP);
  });

  it("saves every field (e-mail trimmed and lowercased) and moves updatedAt on", async () => {
    const result = await save({
      name: "  Salon Nova ",
      phone: "+386 1 234 56 78",
      address: null,
      email: " Salon@Example.SI ",
      openingHours: { ...TEMPLATE_HOURS, sat: [] },
      slotGridMinutes: 30,
      holidaysClosed: false,
      reminderOffsets: [1440, 120],
      sharedDevice: true,
    });
    expect(result).toEqual({ status: "saved" });
    const row = await businessRow(f.a);
    expect(row).toMatchObject({
      name: "Salon Nova",
      phone: "+386 1 234 56 78",
      address: null,
      email: "salon@example.si",
      openingHours: { ...TEMPLATE_HOURS, sat: [] },
      slotGridMinutes: 30,
      holidaysClosed: false,
      reminderOffsets: [1440, 120],
      sharedDevice: true,
      slug: f.aSlug,
      timeZone: TZ,
    });
    expect(row?.updatedAt.getTime()).toBeGreaterThan(STAMP.getTime());
    const read = await getBusinessSettings(db, f.users.olga);
    expect(read.updatedAt).toEqual(row?.updatedAt);
  });

  it("a stale form (expectedUpdatedAt ≠ stored) is settings_changed and writes nothing", async () => {
    expect(await save({ name: "Prvi" })).toEqual({ status: "saved" });
    const after = await businessRow(f.a);
    // The second device still holds STAMP.
    expect(await outcome(save({ name: "Drugi" }))).toBe("settings_changed");
    expect(await businessRow(f.a)).toEqual(after);
    // With the fresh stamp it saves.
    expect(await save({ name: "Drugi", expectedUpdatedAt: after?.updatedAt })).toEqual({ status: "saved" });
    expect((await businessRow(f.a))?.name).toBe("Drugi");
  });

  it("locks the business row (FOR UPDATE) before it reads or writes", async () => {
    const executeRaw = vi.spyOn(prismock, "$executeRaw");
    const update = vi.spyOn(prismock.flowkoBusiness, "update");
    await save({ name: "Salon Nova" });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sql = (executeRaw.mock.calls[0][0] as unknown as TemplateStringsArray).join("?");
    expect(sql).toMatch(/SELECT 1 FROM "FlowkoBusiness" WHERE "id" = \? FOR UPDATE/);
    expect(executeRaw.mock.calls[0][1]).toBe(f.a);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });
});

describe("updateBusinessSettings: mirrors (S4)", () => {
  it("a rename and a reminder choice reach every mirror of the business, not another business's", async () => {
    const ana = await ensureWorkerMirror(tx, f.members.ana);
    const olga = await ensureWorkerMirror(tx, f.members.olga);
    const bea = await ensureWorkerMirror(tx, f.members.bea);
    expect(await save({ name: "Salon Nova", reminderOffsets: [120] })).toEqual({ status: "saved" });
    for (const id of [ana.eventTypeId, olga.eventTypeId]) {
      const eventType = await eventTypeOf(id);
      expect(eventType.title).toBe("Salon Nova");
      expect(eventType.metadata).toStrictEqual({
        flowkoMirror: true,
        flowkoReminders: { enabled: true, offsets: [120] },
      });
    }
    const other = await eventTypeOf(bea.eventTypeId);
    expect(other.title).toBe("Salon B");
    expect(other.metadata).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [1440] },
    });
  });

  it("reminders off ([]): enabled false; a mirror created afterwards carries the same choice", async () => {
    const ana = await ensureWorkerMirror(tx, f.members.ana);
    await save({ reminderOffsets: [] });
    expect((await eventTypeOf(ana.eventTypeId)).metadata).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: false, offsets: [1440] },
    });
    const olga = await ensureWorkerMirror(tx, f.members.olga);
    expect((await eventTypeOf(olga.eventTypeId)).metadata).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: false, offsets: [1440] },
    });
  });

  it("unchanged name and reminder choice: no mirror write", async () => {
    await ensureWorkerMirror(tx, f.members.ana);
    const updateMany = vi.spyOn(prismock.eventType, "updateMany");
    const update = vi.spyOn(prismock.eventType, "update");
    expect(await save({ phone: "01 999 99 99", sharedDevice: true })).toEqual({ status: "saved" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("updateBusinessSettings: narrower opening hours (S3)", () => {
  async function anaMirror(): Promise<number> {
    return (await ensureWorkerMirror(tx, f.members.ana)).eventTypeId;
  }

  it("Mon 07–20 → 08–20 with Ana's usual Monday 07–15 and a booking Mon 07:30: needs_confirm, nothing changed", async () => {
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.ana },
      data: { usualWeek: EARLY_WEEK },
    });
    const booking = await bookingOn(
      await anaMirror(),
      f.users.ana,
      at("2026-11-23", "07:30"),
      at("2026-11-23", "08:15")
    );
    const before = await businessRow(f.a);

    expect(await save({ openingHours: MONDAY_FROM_8 })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 1, bookings: 1 },
    });
    expect(await businessRow(f.a)).toEqual(before);

    expect(await save({ openingHours: MONDAY_FROM_8, confirm: true })).toEqual({ status: "saved" });
    expect((await businessRow(f.a))?.openingHours).toEqual(MONDAY_FROM_8);
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: f.members.ana } });
    expect(member?.usualWeek).toEqual(EARLY_WEEK);
    const stored = await prismock.booking.findUnique({ where: { id: booking } });
    expect(stored?.startTime).toEqual(at("2026-11-23", "07:30"));
    expect(stored?.status).toBe(BookingStatus.ACCEPTED);
  });

  it("counts usual weeks of LOCKED workers and roster days from today on, by weekday", async () => {
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.dan },
      data: { usualWeek: EARLY_WEEK },
    });
    const early = [{ from: "07:00", to: "12:00" }];
    await prismock.flowkoRosterDay.createMany({
      data: [
        { memberId: f.members.ana, date: new Date("2026-11-09T00:00:00Z"), shifts: early }, // past Monday
        { memberId: f.members.ana, date: new Date("2026-11-16T00:00:00Z"), shifts: early }, // today (Monday)
        { memberId: f.members.ana, date: new Date("2026-11-30T00:00:00Z"), shifts: early }, // a later Monday
        { memberId: f.members.ana, date: new Date("2026-11-17T00:00:00Z"), shifts: early }, // Tuesday: unchanged
        { memberId: f.members.ana, date: new Date("2026-11-23T00:00:00Z"), shifts: [] }, // Monday off
      ],
    });
    expect(await save({ openingHours: MONDAY_FROM_8 })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 3, bookings: 0 },
    });
  });

  it("does not count bookings that end before now, cancelled ones, Cal's own, another business's, or ones inside", async () => {
    const mirror = await anaMirror();
    const bea = await ensureWorkerMirror(tx, f.members.bea);
    const own = await prismock.eventType.create({
      data: { title: "Posvet", slug: "posvet-u29a", length: 30, userId: f.users.ana },
      select: { id: true },
    });
    // Today 07:15–07:45 ended before NOW (08:07).
    await bookingOn(mirror, f.users.ana, at("2026-11-16", "07:15"), at("2026-11-16", "07:45"));
    await bookingOn(
      mirror,
      f.users.ana,
      at("2026-11-23", "07:30"),
      at("2026-11-23", "08:00"),
      BookingStatus.CANCELLED
    );
    await bookingOn(own.id, f.users.ana, at("2026-11-23", "07:30"), at("2026-11-23", "08:00"));
    await bookingOn(bea.eventTypeId, f.users.bea, at("2026-11-23", "07:30"), at("2026-11-23", "08:00"));
    await bookingOn(mirror, f.users.ana, at("2026-11-23", "08:00"), at("2026-11-23", "09:00"));
    // Tuesday 07:30 keeps its opening.
    await bookingOn(mirror, f.users.ana, at("2026-11-24", "07:30"), at("2026-11-24", "08:00"));
    // PENDING holds time: counted.
    await bookingOn(
      mirror,
      f.users.ana,
      at("2026-11-30", "07:00"),
      at("2026-11-30", "07:30"),
      BookingStatus.PENDING
    );
    expect(await save({ openingHours: MONDAY_FROM_8 })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 0, bookings: 1 },
    });
  });

  it("entries already outside the old opening are not counted again (Ruling); widening saves at once", async () => {
    // Ana's Saturday 13:00–15:00 and a Saturday booking 14:00 were placed outside opening earlier, with the warning.
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.ana },
      data: { usualWeek: { ...EARLY_WEEK, sat: [{ from: "13:00", to: "15:00" }] } },
    });
    await bookingOn(await anaMirror(), f.users.ana, at("2026-11-21", "14:00"), at("2026-11-21", "14:30"));
    const narrowerSaturday = { ...TEMPLATE_HOURS, sat: [{ from: "08:00", to: "12:00" }] };
    expect(await save({ openingHours: narrowerSaturday })).toEqual({ status: "saved" });

    const after = await businessRow(f.a);
    const wider = { ...narrowerSaturday, mon: [{ from: "06:00", to: "21:00" }] };
    expect(await save({ openingHours: wider, expectedUpdatedAt: after?.updatedAt })).toEqual({
      status: "saved",
    });
  });

  it("opening and holiday switch unchanged: no count, even with entries outside", async () => {
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.ana },
      data: { usualWeek: EARLY_WEEK },
    });
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { openingHours: MONDAY_FROM_8 } });
    const findMany = vi.spyOn(prismock.booking, "findMany");
    expect(await save({ openingHours: MONDAY_FROM_8, name: "Salon Nova" })).toEqual({ status: "saved" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("holidaysClosed off → on counts future bookings on closed work-free days, not on opened ones", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { holidaysClosed: false } });
    const mirror = await anaMirror();
    // Fri 25 Dec 2026 (božič) and Sat 26 Dec 2026 (dan samostojnosti in enotnosti).
    await bookingOn(mirror, f.users.ana, at("2026-12-25", "09:00"), at("2026-12-25", "09:30"));
    await bookingOn(mirror, f.users.ana, at("2026-12-26", "09:00"), at("2026-12-26", "09:30"));
    await bookingOn(mirror, f.users.ana, at("2026-12-28", "09:00"), at("2026-12-28", "09:30"));
    expect(await save({ holidaysClosed: true })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 0, bookings: 2 },
    });
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { openHolidays: ["2026-12-26"] } });
    expect(await save({ holidaysClosed: true })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 0, bookings: 1 },
    });
    expect(await save({ holidaysClosed: true, confirm: true })).toEqual({ status: "saved" });
    expect((await businessRow(f.a))?.holidaysClosed).toBe(true);
  });

  it("holidaysClosed on → off never asks", async () => {
    await bookingOn(await anaMirror(), f.users.ana, at("2026-12-25", "09:00"), at("2026-12-25", "09:30"));
    expect(await save({ holidaysClosed: false })).toEqual({ status: "saved" });
  });
});
