// Flowko U28: the logged no-show (D4) on prismock. The fixture is bookingChange.test.ts's: business A (owner Olga,
// login workers Ana, Bor and Dan (LOCKED after his booking is written), desk-only worker Cene, staff Rok) and B
// (owner Zala); Ana's Barvanje 09:00–10:40, Bor's men's cut 13:00–13:30 and Dan's Barvanje 09:00 on Mon 16 Nov
// 2026, booked on Mon 9 Nov. The one-transaction proof (a failed action insert leaves noShow unchanged) runs on
// Postgres (bookingWriter.integration-test.ts).
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelBusinessBooking } from "./bookingChange";
import { setBusinessNoShow } from "./bookingNoShow";
import { type CreateBookingInput, createBusinessBooking } from "./bookingWriter";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import type { FlowkoBusinessError } from "./errors";
import { setUsualWeek } from "./roster";

vi.mock("./bookingMail", () => ({
  sendBusinessBookingCreated: vi.fn(async () => undefined),
  sendBusinessBookingMoved: vi.fn(async () => undefined),
  sendBusinessBookingCancelled: vi.fn(async () => undefined),
}));

const db = prismock as unknown as FlowkoDb;
const TZ = "Europe/Ljubljana";
const BOOKED_AT = new Date("2026-11-09T06:00:00Z"); // Mon 9 Nov 07:00 in Ljubljana
const DATE = "2026-11-16"; // a Monday
const at = (time: string) => new Date(wallClockToMs(DATE, time, TZ));
/** 09:30 on the day: Ana's and Dan's 09:00 bookings have started, Bor's 13:00 has not. */
const STARTED = at("09:30");
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
  users: { olga: number; ana: number; bor: number; rok: number; zala: number };
  members: { olga: number; ana: number; bor: number; cene: number; rok: number };
  ana: number;
  bor: number;
  dan: number;
  olgaPlain: number;
};

async function book(actorUserId: number, over: Partial<CreateBookingInput>): Promise<number> {
  const input: CreateBookingInput = {
    workerMemberId: 0,
    serviceIds: [],
    start: at("09:00"),
    customer: { name: "Marija Novak", phone: "041 123 456" },
    confirmOverride: false,
    ...over,
  };
  const result = await createBusinessBooking(db, actorUserId, input, BOOKED_AT, {
    lockWorker: async () => undefined,
    googleBusy: async () => ({ busy: [], unavailable: false }),
    sendMails: false,
  });
  if (result.status !== "created")
    throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  return result.bookingId;
}

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `bn-a-${seq}`,
    templateId: "hair-salon",
    address: "Glavna ulica 1, Ljubljana",
  });
  const a = created.businessId;
  // Flowko U29a: S7, the U27/U28 actor tests assume the shared device switch on (U28b behaviour).
  await prismock.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [], sharedDevice: true } });
  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, a, bor, FlowkoBusinessRole.WORKER);
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, a, dan, FlowkoBusinessRole.WORKER);
  const cene = await createDeskOnlyWorker(db, a, "Cene");
  await addStaffWithoutLogin(db, a, "Recepcija");

  const zala = await makeUser("Zala");
  await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `bn-b-${seq}`,
    templateId: "hair-salon",
  });

  const services = await prismock.flowkoService.findMany({
    where: { businessId: a },
    select: { id: true, name: true },
  });
  const idOf = (name: string) => {
    const s = services.find((x) => x.name === name);
    if (!s) throw new Error(`fixture: service ${name} missing`);
    return s.id;
  };
  const ids = { mens: idOf("Moško striženje"), colouring: idOf("Barvanje") };
  const assign = (serviceId: number, memberId: number) =>
    prismock.flowkoServiceWorker.create({ data: { serviceId, memberId } });
  for (const memberId of [anaMember.memberId, danMember.memberId]) {
    await assign(ids.mens, memberId);
    await assign(ids.colouring, memberId);
  }
  await assign(ids.mens, borMember.memberId);

  const usual = (memberId: number, hours: ShiftEntry[]) =>
    setUsualWeek(db, olga, { memberId, usualWeek: week(hours), confirmOutsideOpening: false });
  for (const memberId of [anaMember.memberId, danMember.memberId]) {
    await usual(memberId, [{ from: "07:00", to: "15:00" }]);
  }
  await usual(borMember.memberId, [{ from: "12:00", to: "20:00" }]);

  const anaBooking = await book(olga, { workerMemberId: anaMember.memberId, serviceIds: [ids.colouring] });
  const borBooking = await book(olga, {
    workerMemberId: borMember.memberId,
    serviceIds: [ids.mens],
    start: at("13:00"),
  });
  const danBooking = await book(olga, { workerMemberId: danMember.memberId, serviceIds: [ids.colouring] });
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED },
  });

  const plainType = await prismock.eventType.create({
    data: { title: "Olgin posvet", slug: `posvet-${seq}`, length: 30, owner: { connect: { id: olga } } },
    select: { id: true },
  });
  const plain = await prismock.booking.create({
    data: {
      uid: `plain-${seq}`,
      title: "Posvet",
      startTime: at("08:00"),
      endTime: at("08:30"),
      status: BookingStatus.ACCEPTED,
      user: { connect: { id: olga } },
      eventType: { connect: { id: plainType.id } },
      attendees: { create: { name: "Gost", email: "gost@example.com", timeZone: TZ } },
    },
    select: { id: true },
  });

  return {
    a,
    users: { olga, ana, bor, rok, zala },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      rok: rokMember.memberId,
    },
    ana: anaBooking,
    bor: borBooking,
    dan: danBooking,
    olgaPlain: plain.id,
  };
}

let f: Fixture;

beforeEach(async () => {
  f = await setUp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "FlowkoBusinessError",
    code,
  } as Partial<FlowkoBusinessError>);
}

const noShow = (
  actorUserId: number,
  bookingId: number,
  value: boolean,
  now = STARTED,
  actorMemberId?: number | null
) => setBusinessNoShow(db, actorUserId, { bookingId, noShow: value, actorMemberId }, now);
const attendeeFlags = async (bookingId: number) =>
  (await prismock.attendee.findMany({ where: { bookingId }, orderBy: { id: "asc" } })).map((a) => a.noShow);
const noShowActions = (bookingId: number) =>
  prismock.flowkoBookingAction.findMany({ where: { bookingId, action: "NO_SHOW" }, orderBy: { id: "asc" } });
const actionCount = () => prismock.flowkoBookingAction.count({ where: { action: "NO_SHOW" } });

describe("setBusinessNoShow (D4)", () => {
  it("Olga marks Ana's started booking: Attendee.noShow true, a NO_SHOW action { noShow: true } with the actor", async () => {
    expect(await attendeeFlags(f.ana)).toEqual([false]);
    expect(await noShow(f.users.olga, f.ana, true)).toEqual({ status: "updated", noShow: true });
    expect(await attendeeFlags(f.ana)).toEqual([true]);
    const actions = await noShowActions(f.ana);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      businessId: f.a,
      action: "NO_SHOW",
      actorMemberId: f.members.olga,
      actorName: "Olga",
      userId: f.users.olga,
      details: { noShow: true },
    });
    // No status change: the booking stays ACCEPTED.
    expect((await prismock.booking.findUnique({ where: { id: f.ana } }))?.status).toBe(
      BookingStatus.ACCEPTED
    );
  });

  it("undo: noShow false and a second action { noShow: false }", async () => {
    await noShow(f.users.olga, f.ana, true);
    expect(await noShow(f.users.olga, f.ana, false)).toEqual({ status: "updated", noShow: false });
    expect(await attendeeFlags(f.ana)).toEqual([false]);
    expect((await noShowActions(f.ana)).map((a) => a.details)).toEqual([{ noShow: true }, { noShow: false }]);
  });

  it("at the exact start → allowed (startTime ≤ now, raw now); a minute before → booking_not_started", async () => {
    await expectCode(noShow(f.users.olga, f.ana, true, at("08:59")), "booking_not_started");
    // 08:59:30 rounds down to the 08:45 grid slot but is still before the start: raw now decides.
    await expectCode(
      noShow(f.users.olga, f.ana, true, new Date(at("09:00").getTime() - 30_000)),
      "booking_not_started"
    );
    expect(await attendeeFlags(f.ana)).toEqual([false]);
    expect(await actionCount()).toBe(0);
    expect((await noShow(f.users.olga, f.ana, true, at("09:00"))).noShow).toBe(true);
  });

  it("Bor's 13:00 booking at 09:30 → booking_not_started (undo too)", async () => {
    await expectCode(noShow(f.users.olga, f.bor, true), "booking_not_started");
    await expectCode(noShow(f.users.olga, f.bor, false), "booking_not_started");
  });

  it("Ana marks her own; Ana on Bor's → forbidden; Zala and an unknown id → forbidden", async () => {
    await noShow(f.users.ana, f.ana, true);
    expect((await noShowActions(f.ana))[0]).toMatchObject({
      actorMemberId: f.members.ana,
      userId: f.users.ana,
    });
    await expectCode(noShow(f.users.ana, f.bor, true, at("13:10")), "forbidden");
    await expectCode(noShow(f.users.zala, f.ana, true), "forbidden");
    await expectCode(noShow(f.users.olga, 999_999, true), "forbidden");
    expect(await attendeeFlags(f.bor)).toEqual([false]);
    expect(await actionCount()).toBe(1);
  });

  it("a CANCELLED booking → booking_not_active", async () => {
    await cancelBusinessBooking(db, f.users.olga, { bookingId: f.ana }, BOOKED_AT, { sendMails: false });
    await expectCode(noShow(f.users.olga, f.ana, true), "booking_not_active");
    expect(await attendeeFlags(f.ana)).toEqual([false]);
    expect(await actionCount()).toBe(0);
  });

  it("a PENDING business booking → booking_not_active", async () => {
    await prismock.booking.update({ where: { id: f.ana }, data: { status: BookingStatus.PENDING } });
    await expectCode(noShow(f.users.olga, f.ana, true), "booking_not_active");
  });

  it("Olga's own booking on an ordinary event type → not_business_booking", async () => {
    await expectCode(noShow(f.users.olga, f.olgaPlain, true), "not_business_booking");
    expect(await attendeeFlags(f.olgaPlain)).toEqual([false]);
  });

  it("Dan's booking (LOCKED worker) by Olga → allowed (as cancel)", async () => {
    expect(await noShow(f.users.olga, f.dan, true)).toEqual({ status: "updated", noShow: true });
    expect(await attendeeFlags(f.dan)).toEqual([true]);
  });

  it("Rok (staff) marks Ana's with actor Recepcija: actor Recepcija, user Rok", async () => {
    const recepcija = await prismock.flowkoBusinessMember.findFirst({ where: { displayName: "Recepcija" } });
    await noShow(f.users.rok, f.ana, true, STARTED, recepcija?.id);
    expect((await noShowActions(f.ana))[0]).toMatchObject({
      actorMemberId: recepcija?.id,
      actorName: "Recepcija",
      userId: f.users.rok,
    });
  });

  it("Ana (WORKER) naming Olga as actor → forbidden, nothing written; her own id → ok", async () => {
    await expectCode(noShow(f.users.ana, f.ana, true, STARTED, f.members.olga), "forbidden");
    expect(await attendeeFlags(f.ana)).toEqual([false]);
    expect(await actionCount()).toBe(0);
    await noShow(f.users.ana, f.ana, true, STARTED, f.members.ana);
    expect(await attendeeFlags(f.ana)).toEqual([true]);
  });

  it("Olga naming Cene → ok (U27 W6 unchanged)", async () => {
    await noShow(f.users.olga, f.ana, true, STARTED, f.members.cene);
    expect((await noShowActions(f.ana))[0]).toMatchObject({
      actorMemberId: f.members.cene,
      actorName: "Cene",
    });
  });

  it("a non-boolean noShow or a non-integer booking id is refused before any write", async () => {
    await expectCode(
      setBusinessNoShow(db, f.users.olga, { bookingId: f.ana, noShow: "yes" as unknown as boolean }, STARTED),
      "bad_booking"
    );
    await expectCode(
      setBusinessNoShow(db, f.users.olga, { bookingId: 1.5, noShow: true }, STARTED),
      "forbidden"
    );
    expect(await actionCount()).toBe(0);
  });
});

// Flowko U29a: S7, with the shared device switch off an OWNER/STAFF session always acts as itself.
describe("sharedDevice off (U29a S7)", () => {
  beforeEach(async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { sharedDevice: false } });
  });

  const sharedDeviceReads = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((call) => {
      const select = (call[0] as { select?: Record<string, unknown> } | undefined)?.select;
      return select?.sharedDevice === true;
    }).length;

  it("Olga (OWNER) naming Cene (ACTIVE), Dan (LOCKED), Zala (foreign) or an unknown id → Olga, no error", async () => {
    const dan = await prismock.flowkoBusinessMember.findFirst({
      where: { businessId: f.a, status: FlowkoMemberStatus.LOCKED },
    });
    const zala = await prismock.flowkoBusinessMember.findFirst({ where: { businessId: { not: f.a } } });
    expect(dan?.id).toBeDefined();
    expect(zala?.id).toBeDefined();
    const ids = [f.members.cene, dan?.id, zala?.id, 999_999];
    let value = true;
    for (const id of ids) {
      expect(await noShow(f.users.olga, f.ana, value, STARTED, id)).toEqual({
        status: "updated",
        noShow: value,
      });
      value = !value;
    }
    expect((await noShowActions(f.ana)).map((a) => [a.actorMemberId, a.actorName, a.userId])).toEqual(
      ids.map(() => [f.members.olga, "Olga", f.users.olga])
    );
  });

  it("Rok (STAFF) naming Recepcija → Rok", async () => {
    const recepcija = await prismock.flowkoBusinessMember.findFirst({ where: { displayName: "Recepcija" } });
    expect(recepcija?.id).toBeDefined();
    await noShow(f.users.rok, f.ana, true, STARTED, recepcija?.id);
    expect((await noShowActions(f.ana))[0]).toMatchObject({
      actorMemberId: f.members.rok,
      actorName: "Rok",
      userId: f.users.rok,
    });
  });

  it("Ana (WORKER) naming Olga or Cene → forbidden, nothing written", async () => {
    await expectCode(noShow(f.users.ana, f.ana, true, STARTED, f.members.olga), "forbidden");
    await expectCode(noShow(f.users.ana, f.ana, true, STARTED, f.members.cene), "forbidden");
    expect(await attendeeFlags(f.ana)).toEqual([false]);
    expect(await actionCount()).toBe(0);
  });

  it("no read of the switch when actorMemberId is absent or the own member", async () => {
    const findUnique = vi.spyOn(prismock.flowkoBusiness, "findUnique");
    const findFirst = vi.spyOn(prismock.flowkoBusiness, "findFirst");
    await noShow(f.users.olga, f.ana, true);
    await noShow(f.users.olga, f.ana, false, STARTED, null);
    await noShow(f.users.rok, f.ana, true, STARTED, f.members.rok);
    expect(sharedDeviceReads(findUnique) + sharedDeviceReads(findFirst)).toBe(0);
    await noShow(f.users.olga, f.ana, false, STARTED, f.members.cene);
    expect(sharedDeviceReads(findUnique) + sharedDeviceReads(findFirst)).toBe(1);
  });
});
