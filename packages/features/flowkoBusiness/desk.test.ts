// Flowko U28: the desk read service on prismock (Task 2). Fixture as bookingWriter.test.ts: business A (owner Olga,
// login workers Ana, Bor (usual 12–20) and Dan (LOCKED after his booking), desk-only worker Cene, staff Rok with a
// login, staff Recepcija without one) and B (owner Zala). Mon 16 Nov 2026 (Ljubljana): Ana Barvanje 09:00 (trusted
// steps), Bor Moško 13:00, Dan Moško 11:00 (inserted directly with its step copy), Olga's own non-mirror booking
// 12:00–13:00, a cancelled Ana booking, a B booking. Google is a stub. Review Focus 1 (RF1): every response is
// deep-walked for a uid, a userId key, a worker e-mail and the desk-only placeholder domain.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import logger from "@calcom/lib/logger";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelBusinessBooking, cancelBusinessBookingAsCustomer } from "./bookingChange"; // Flowko U29e: E6
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import {
  type DeskView,
  findCustomers,
  getDeskDay,
  getDeskWeek,
  listDeskMembers,
  listDeskServices,
} from "./desk";
import type { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { setUsualWeek } from "./roster";
import { saveService } from "./services"; // Flowko U29e: E8

const db = prismock as unknown as FlowkoDb;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const DATE = "2026-11-16"; // a Monday
const TUE = "2026-11-17";
const at = (time: string, date = DATE) => new Date(wallClockToMs(date, time, TZ));
const iso = (time: string, date = DATE) => at(time, date).toISOString();
const ms = (time: string, date = DATE) => at(time, date).getTime();
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
  users: { olga: number; ana: number; bor: number; rok: number; dan: number; zala: number };
  members: { olga: number; ana: number; bor: number; cene: number; dan: number; rok: number; zala: number };
  cene: { userId: number };
  services: Record<"mens" | "colouring", number>;
  bookings: { ana: number; bor: number; dan: number; olgaOwn: number; cancelled: number; b: number };
};

const MARIJA = { name: "Marija Novak", phone: "041 123 456", email: "marija@example.com" };
const PETRA = { name: "Petra Kos", phone: "031 555 666" };

const noGoogle: NonNullable<WriterDeps["googleBusy"]> = async () => ({ busy: [], unavailable: false });
const writerDeps: WriterDeps = { lockWorker: async () => undefined, googleBusy: noGoogle, sendMails: false };

async function book(actor: number, input: Omit<CreateBookingInput, "confirmOverride">): Promise<number> {
  const result = await createBusinessBooking(db, actor, { ...input, confirmOverride: false }, NOW, writerDeps);
  if (result.status !== "created") throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  return result.bookingId;
}

/** A booking written directly (the writer would refuse it), with its attendee, steps and a CREATED action. */
async function insertBooking(input: {
  userId: number;
  eventTypeId: number | null;
  businessId?: number;
  start: Date;
  end: Date;
  attendee: { name: string; email: string; phoneNumber?: string | null };
  steps?: Array<{ kind: "busy" | "processing"; start: Date; end: Date; serviceId: number | null; name: string }>;
  createdAt?: Date;
  status?: BookingStatus;
  title?: string;
}): Promise<number> {
  seq += 1;
  const booking = await prismock.booking.create({
    data: {
      uid: `fixtureuid${seq}x${Math.random().toString(36).slice(2, 10)}`,
      title: input.title ?? "Direct",
      startTime: input.start,
      endTime: input.end,
      status: input.status ?? BookingStatus.ACCEPTED,
      userId: input.userId,
      eventTypeId: input.eventTypeId,
      ...(input.createdAt && { createdAt: input.createdAt }),
    },
    select: { id: true },
  });
  await prismock.attendee.create({
    data: {
      bookingId: booking.id,
      name: input.attendee.name,
      email: input.attendee.email,
      phoneNumber: input.attendee.phoneNumber ?? null,
      timeZone: TZ,
    },
  });
  const steps = input.steps ?? [];
  for (let index = 0; index < steps.length; index += 1) {
    const s = steps[index];
    await prismock.flowkoBookingStep.create({
      data: {
        bookingId: booking.id,
        index,
        kind: s.kind,
        startTime: s.start,
        endTime: s.end,
        serviceId: s.serviceId,
        serviceName: s.name,
      },
    });
  }
  if (input.businessId !== undefined) {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: booking.id,
        businessId: input.businessId,
        action: "CREATED",
        actorName: "Olga",
      },
    });
  }
  return booking.id;
}

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `desk-a-${seq}`,
    templateId: "hair-salon",
    address: "Glavna ulica 1, Ljubljana",
  });
  const a = created.businessId;
  await prismock.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [] } });
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
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `desk-b-${seq}`,
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
  for (const memberId of [anaMember.memberId, cene.memberId, danMember.memberId]) {
    await assign(ids.mens, memberId);
    await assign(ids.colouring, memberId);
  }
  await assign(ids.mens, borMember.memberId);

  const usual = (memberId: number, hours: ShiftEntry[]) =>
    setUsualWeek(db, olga, { memberId, usualWeek: week(hours), confirmOutsideOpening: false });
  for (const memberId of [anaMember.memberId, cene.memberId, danMember.memberId]) {
    await usual(memberId, [{ from: "07:00", to: "15:00" }]);
  }
  await usual(borMember.memberId, [{ from: "12:00", to: "20:00" }]);

  const anaBooking = await book(olga, {
    workerMemberId: anaMember.memberId,
    serviceIds: [ids.colouring],
    start: at("09:00"),
    customer: MARIJA,
  });
  const borBooking = await book(olga, {
    workerMemberId: borMember.memberId,
    serviceIds: [ids.mens],
    start: at("13:00"),
    customer: PETRA,
  });
  const cancelled = await book(olga, {
    workerMemberId: anaMember.memberId,
    serviceIds: [ids.mens],
    start: at("12:00"),
    customer: MARIJA,
  });
  await prismock.booking.update({ where: { id: cancelled }, data: { status: BookingStatus.CANCELLED } });
  // Marija's third booking (Tuesday, Cene).
  await book(olga, {
    workerMemberId: cene.memberId,
    serviceIds: [ids.mens],
    start: at("09:00", TUE),
    customer: MARIJA,
  });

  // Dan's booking is written directly (he is LOCKED), with its step copy.
  const danMirror = await ensureWorkerMirror(db as never, danMember.memberId);
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED },
  });
  const danBooking = await insertBooking({
    userId: dan,
    eventTypeId: danMirror.eventTypeId,
    businessId: a,
    start: at("11:00"),
    end: at("11:30"),
    attendee: { name: "Janez Dolenc", email: "janez@example.com" },
    steps: [{ kind: "busy", start: at("11:00"), end: at("11:30"), serviceId: ids.mens, name: "Moško striženje" }],
  });
  const olgaOwn = await insertBooking({
    userId: olga,
    eventTypeId: null,
    start: at("12:00"),
    end: at("13:00"),
    title: "Zasebni sestanek",
    attendee: { name: "Zasebna Oseba", email: "private@example.com" },
  });
  const zalaMirror = await ensureWorkerMirror(db as never, createdB.ownerMemberId);
  const bBooking = await insertBooking({
    userId: zala,
    eventTypeId: zalaMirror.eventTypeId,
    businessId: createdB.businessId,
    start: at("10:00"),
    end: at("10:30"),
    attendee: { name: "Mara Bistra", email: "mara@example.com", phoneNumber: "+38640111222" },
  });

  return {
    a,
    b: createdB.businessId,
    users: { olga, ana, bor, rok, dan, zala },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      dan: danMember.memberId,
      rok: rokMember.memberId,
      zala: createdB.ownerMemberId,
    },
    cene: { userId: cene.userId },
    services: ids,
    bookings: { ana: anaBooking, bor: borBooking, dan: danBooking, olgaOwn, cancelled, b: bBooking },
  };
}

let f: Fixture;
let googleBusy: ReturnType<typeof vi.fn<NonNullable<WriterDeps["googleBusy"]>>>;

beforeEach(async () => {
  f = await setUp();
  googleBusy = vi.fn(async () => ({ busy: [], unavailable: false }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const day = (userId: number, now = NOW, date = DATE) => getDeskDay(db, userId, { date }, now, { googleBusy });

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "FlowkoBusinessError",
    code,
  } as Partial<FlowkoBusinessError>);
}

const rowOf = (view: DeskView, bookingId: number) => {
  const row = view.days.flatMap((d) => d.bookings).find((b) => b.bookingId === bookingId);
  if (!row) throw new Error(`row ${bookingId} missing`);
  return row;
};
const columnOf = (view: DeskView, memberId: number) => {
  const column = view.days[0].columns.find((c) => c.memberId === memberId);
  if (!column) throw new Error(`column ${memberId} missing`);
  return column;
};
const flags = (row: { mayCancel: boolean; mayMove: boolean; mayNoShow: boolean; mayReenter: boolean }) => ({
  mayCancel: row.mayCancel,
  mayMove: row.mayMove,
  mayNoShow: row.mayNoShow,
  mayReenter: row.mayReenter,
});

/** RF1: no `uid`/`userId` key, no string containing a booking uid, a worker e-mail or the placeholder domain. */
async function expectNoPrivateData(response: unknown): Promise<void> {
  const uids = (await prismock.booking.findMany({ select: { uid: true } })).map((b) => b.uid);
  const memberUsers = await prismock.flowkoBusinessMember.findMany({ select: { userId: true } });
  const userIds = memberUsers.map((m) => m.userId).filter((id): id is number => id !== null);
  const emails = (await prismock.user.findMany({ select: { id: true, email: true } }))
    .filter((u) => userIds.includes(u.id))
    .map((u) => u.email.toLowerCase());
  expect(uids.length).toBeGreaterThan(0);
  expect(emails.length).toBeGreaterThan(5);
  const problems: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (uids.some((uid) => value.includes(uid))) problems.push(`${path}: uid`);
      if (lower.includes("@flowko.invalid")) problems.push(`${path}: placeholder`);
      if (emails.some((e) => lower.includes(e))) problems.push(`${path}: worker e-mail`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (key === "uid" || key === "userId" || key === "iCalUID") problems.push(`${path}.${key}: key`);
        walk(v, `${path}.${key}`);
      }
    }
  };
  walk(response, "$");
  expect(problems).toEqual([]);
}

describe("getDeskDay: columns and rows (R2, R4)", () => {
  // Flowko U29e: E6, R9 — the day answer now carries the cancelled Ana booking (12:00) as a faded row.
  it("Olga: columns in roster order + the locked Dan column; rows Ana, Dan, cancelled Ana, Bor (no B)", async () => {
    const view = await day(f.users.olga);
    expect(view.timeZone).toBe(TZ);
    expect(view.slotStepMinutes).toBeGreaterThan(0);
    expect(view.me).toEqual({ memberId: f.members.olga, role: FlowkoBusinessRole.OWNER });
    expect(view.now).toBe(iso("08:00")); // 08:07 rounded down to the grid (R18)
    expect(view.days).toHaveLength(1);
    const d = view.days[0];
    expect(d.date).toBe(DATE);
    expect(d.holiday).toBeNull();
    expect(d.opening.length).toBeGreaterThan(0);
    expect(d.columns.map((c) => [c.memberId, c.displayName, c.locked, c.deskOnly, c.isMe])).toEqual([
      [f.members.olga, "Olga", false, false, true],
      [f.members.ana, "Ana", false, false, false],
      [f.members.bor, "Bor", false, false, false],
      [f.members.cene, "Cene", false, true, false],
      [f.members.dan, "Dan", true, false, false],
    ]);
    expect(columnOf(view, f.members.ana).shifts).toEqual([{ start: ms("07:00"), end: ms("15:00") }]);
    expect(columnOf(view, f.members.bor).shifts).toEqual([{ start: ms("12:00"), end: ms("20:00") }]);
    expect(columnOf(view, f.members.dan)).toMatchObject({ shifts: [], timeOff: [], googleUnavailable: false });
    expect(d.bookings.map((b) => b.bookingId)).toEqual([
      f.bookings.ana,
      f.bookings.dan,
      f.bookings.cancelled,
      f.bookings.bor,
    ]);
    expect(d.bookings.map((b) => b.memberId)).toEqual([
      f.members.ana,
      f.members.dan,
      f.members.ana,
      f.members.bor,
    ]);
    expect(d.bookings.map((b) => b.status)).toEqual([
      BookingStatus.ACCEPTED,
      BookingStatus.ACCEPTED,
      BookingStatus.CANCELLED,
      BookingStatus.ACCEPTED,
    ]);
  });

  it("Olga's own Cal booking is other busy in her column (times only), never a row", async () => {
    const view = await day(f.users.olga);
    expect(columnOf(view, f.members.olga).otherBusy).toEqual([{ start: ms("12:00"), end: ms("13:00") }]);
    expect(view.days[0].bookings.some((b) => b.bookingId === f.bookings.olgaOwn)).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Zasebn");
    // Ana's own business booking is a row, not other busy.
    expect(columnOf(view, f.members.ana).otherBusy).toEqual([]);
  });

  it("Ana's row: fields, three step segments, services, CREATED action", async () => {
    const view = await day(f.users.olga);
    const row = rowOf(view, f.bookings.ana);
    expect(row).toMatchObject({
      bookingId: f.bookings.ana,
      memberId: f.members.ana,
      status: BookingStatus.ACCEPTED,
      start: iso("09:00"),
      end: iso("10:40"),
      title: "Barvanje med Ana in Marija Novak",
      customer: { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
      serviceNames: ["Barvanje"],
      serviceIds: [f.services.colouring],
      noShow: false,
    });
    expect(row.steps).toEqual([
      { kind: "busy", start: iso("09:00"), end: iso("09:30"), serviceName: "Barvanje" },
      { kind: "processing", start: iso("09:30"), end: iso("10:10"), serviceName: "Barvanje" },
      { kind: "busy", start: iso("10:10"), end: iso("10:40"), serviceName: "Barvanje" },
    ]);
    expect(row.actions).toHaveLength(1);
    expect(row.actions[0]).toMatchObject({ kind: "CREATED", actorName: "Olga", details: null });
    // Flowko U29e: E6, R9 — a live row is not cancelled; an action by a member is not the customer's.
    expect(row.cancelled).toBeNull();
    expect(row.cancelReason).toBeNull();
    expect(row.actions[0].byCustomer).toBe(false);
    expect(Object.keys(row.actions[0]).sort()).toEqual(["actorName", "at", "byCustomer", "details", "kind"]);
    expect(typeof row.actions[0].at).toBe("string");
    expect(Object.keys(row).sort()).toEqual(
      [
        "actions",
        "bookingId",
        "cancelReason", // Flowko U29e: E6, R9
        "cancelled", // Flowko U29e: E6, R9
        "customer",
        "end",
        "mayCancel",
        "mayMove",
        "mayNoShow",
        "mayReenter",
        "memberId",
        "noShow",
        "serviceIds",
        "serviceNames",
        "start",
        "status",
        "steps",
        "title",
      ].sort()
    );
  });

  it("a phone-only customer: e-mail null (no @sms.cal.com)", async () => {
    const row = rowOf(await day(f.users.olga), f.bookings.bor);
    expect(row.customer).toEqual({ name: "Petra Kos", phone: "+38631555666", email: null });
  });

  it("actions oldest first", async () => {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.ana,
        businessId: f.a,
        action: "RESCHEDULED",
        actorName: "Rok",
        createdAt: new Date(Date.now() + 60_000),
        details: { fromStart: "x", toStart: "y" },
      },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.ana);
    expect(row.actions.map((a) => a.kind)).toEqual(["CREATED", "RESCHEDULED"]);
    expect(row.actions[1].details).toEqual({ fromStart: "x", toStart: "y" });
  });

  it("action details keep only fromStart, toStart, overrides and noShow (a stored uid never comes back)", async () => {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.ana,
        businessId: f.a,
        action: "RESCHEDULED",
        actorName: "Rok",
        createdAt: new Date(Date.now() + 60_000),
        details: {
          fromStart: "x",
          toStart: "y",
          overrides: ["time_off"],
          uid: "secret-uid",
          email: "ana@example.com",
        },
      },
    });
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.ana,
        businessId: f.a,
        action: "NO_SHOW",
        actorName: "Olga",
        createdAt: new Date(Date.now() + 120_000),
        details: { noShow: true, userId: 7, fromStart: 5, overrides: "time_off" },
      },
    });
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.ana,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Olga",
        createdAt: new Date(Date.now() + 180_000),
        details: { uid: "secret-uid" },
      },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.ana);
    expect(row.actions.map((a) => a.details)).toEqual([
      null,
      { fromStart: "x", toStart: "y", overrides: ["time_off"] },
      { noShow: true },
      null,
    ]);
    expect(JSON.stringify(row)).not.toContain("secret-uid");
  });

  it("a copy that no longer spans the booking → steps null (drawn solid)", async () => {
    await prismock.booking.update({ where: { id: f.bookings.ana }, data: { endTime: at("10:50") } });
    const row = rowOf(await day(f.users.olga), f.bookings.ana);
    expect(row.steps).toBeNull();
    expect(row.serviceNames).toEqual(["Barvanje"]);
  });

  it("a step whose service was deleted (serviceId null) → serviceIds null", async () => {
    await prismock.flowkoBookingStep.updateMany({ where: { bookingId: f.bookings.bor }, data: { serviceId: null } });
    const row = rowOf(await day(f.users.olga), f.bookings.bor);
    expect(row.serviceIds).toBeNull();
    expect(row.serviceNames).toEqual(["Moško striženje"]);
  });

  it("attendee no-show shows on the row", async () => {
    await prismock.attendee.updateMany({ where: { bookingId: f.bookings.ana }, data: { noShow: true } });
    expect(rowOf(await day(f.users.olga), f.bookings.ana).noShow).toBe(true);
  });

  it("a PENDING business booking is a row; another day's booking is not", async () => {
    await prismock.booking.update({ where: { id: f.bookings.bor }, data: { status: BookingStatus.PENDING } });
    const view = await day(f.users.olga);
    expect(rowOf(view, f.bookings.bor).status).toBe(BookingStatus.PENDING);
    const tuesday = await day(f.users.olga, NOW, TUE);
    expect(tuesday.days[0].bookings.map((b) => b.memberId)).toEqual([f.members.cene]);
    expect(tuesday.days[0].columns.some((c) => c.locked)).toBe(false); // Dan has nothing on Tuesday
  });

  it("A1: a mirror booking created before its worker joined is no row, only other busy", async () => {
    const mirror = await prismock.flowkoWorkerMirror.findUnique({ where: { memberId: f.members.ana } });
    const preJoin = await insertBooking({
      userId: f.users.ana,
      eventTypeId: mirror?.eventTypeId ?? null,
      businessId: f.a,
      start: at("13:00"),
      end: at("13:30"),
      createdAt: new Date("2020-01-01T00:00:00Z"),
      attendee: { name: "Stara Stranka", email: "old@example.com" },
    });
    const view = await day(f.users.olga);
    expect(view.days[0].bookings.some((b) => b.bookingId === preJoin)).toBe(false);
    expect(columnOf(view, f.members.ana).otherBusy).toEqual([{ start: ms("13:00"), end: ms("13:30") }]);
    expect(JSON.stringify(view)).not.toContain("Stara");
  });

  it("a bad date → bad_roster", async () => {
    await expectCode(getDeskDay(db, f.users.olga, { date: "2026-13-01" }, NOW, { googleBusy }), "bad_roster");
  });
});

describe("getDeskDay: rights and flags (R5)", () => {
  it("Olga (owner): every flag where it applies; Dan's (locked) row cancel only", async () => {
    const view = await day(f.users.olga);
    expect(flags(rowOf(view, f.bookings.ana))).toEqual({
      mayCancel: true,
      mayMove: true,
      mayNoShow: false, // not started yet
      mayReenter: true,
    });
    expect(flags(rowOf(view, f.bookings.bor))).toEqual({
      mayCancel: true,
      mayMove: true,
      mayNoShow: false,
      mayReenter: true,
    });
    expect(flags(rowOf(view, f.bookings.dan))).toEqual({
      mayCancel: true,
      mayMove: false,
      mayNoShow: false,
      mayReenter: true,
    });
  });

  it("NOW after Ana's start → mayNoShow true; after its end → no cancel, no move", async () => {
    const started = await day(f.users.olga, at("09:10"));
    expect(flags(rowOf(started, f.bookings.ana))).toEqual({
      mayCancel: true,
      mayMove: true,
      mayNoShow: true,
      mayReenter: true,
    });
    const ended = await day(f.users.olga, at("10:40"));
    expect(flags(rowOf(ended, f.bookings.ana))).toEqual({
      mayCancel: false,
      mayMove: false,
      mayNoShow: true,
      mayReenter: false,
    });
  });

  it("a PENDING row: cancel yes, move and no-show no", async () => {
    await prismock.booking.update({ where: { id: f.bookings.bor }, data: { status: BookingStatus.PENDING } });
    const row = rowOf(await day(f.users.olga, at("13:10")), f.bookings.bor);
    expect(flags(row)).toEqual({ mayCancel: true, mayMove: false, mayNoShow: false, mayReenter: true });
  });

  it("Ana (worker): Bor's row in full detail without rights; her own row with rights, no re-enter", async () => {
    const view = await day(f.users.ana, at("13:10"));
    expect(view.me).toEqual({ memberId: f.members.ana, role: FlowkoBusinessRole.WORKER });
    expect(columnOf(view, f.members.ana).isMe).toBe(true);
    const bor = rowOf(view, f.bookings.bor);
    expect(bor.customer.phone).toBe("+38631555666");
    expect(flags(bor)).toEqual({ mayCancel: false, mayMove: false, mayNoShow: false, mayReenter: false });
    const own = rowOf(await day(f.users.ana, at("09:10")), f.bookings.ana);
    expect(flags(own)).toEqual({ mayCancel: true, mayMove: true, mayNoShow: true, mayReenter: false });
    expect(flags(rowOf(view, f.bookings.dan))).toEqual({
      mayCancel: false,
      mayMove: false,
      mayNoShow: false,
      mayReenter: false,
    });
  });

  it("Rok (staff): every flag; no column of his own", async () => {
    const view = await day(f.users.rok, at("09:10"));
    expect(view.me).toEqual({ memberId: f.members.rok, role: FlowkoBusinessRole.STAFF });
    expect(view.days[0].columns.some((c) => c.memberId === f.members.rok || c.isMe)).toBe(false);
    expect(flags(rowOf(view, f.bookings.ana))).toEqual({
      mayCancel: true,
      mayMove: true,
      mayNoShow: true,
      mayReenter: true,
    });
    expect(flags(rowOf(view, f.bookings.bor))).toEqual({
      mayCancel: true,
      mayMove: true,
      mayNoShow: false,
      mayReenter: true,
    });
  });

  it("Zala (owner of B) sees business B only; a stranger and Dan (locked) → forbidden", async () => {
    const zala = await day(f.users.zala);
    expect(zala.me.memberId).toBe(f.members.zala);
    expect(zala.days[0].columns.map((c) => c.memberId)).toEqual([f.members.zala]);
    expect(zala.days[0].bookings.map((b) => b.bookingId)).toEqual([f.bookings.b]);
    expect(JSON.stringify(zala)).not.toMatch(/Marija|Petra|Janez|Ana|Bor/);
    await expectCode(day(await makeUser("Stranger")), "forbidden");
    await expectCode(day(f.users.dan), "forbidden");
  });
});

// Flowko U29e: E6, R9, R10. The day answer carries cancelled bookings (faded on the desk) with who cancelled and
// when; the week does not; a hand-over cancel („Prestavi k drugemu delavcu“) never shows; a LOCKED member with only
// cancelled bookings that day gets no column. The fixture's cancelled Ana 12:00 is a legacy row (no CANCELLED action).
describe("getDeskDay: cancelled bookings (Flowko U29e, E6)", () => {
  const uidOf = async (bookingId: number) => {
    const b = await prismock.booking.findUnique({ where: { id: bookingId }, select: { uid: true } });
    if (!b) throw new Error("fixture: booking missing");
    return b.uid;
  };
  const latestCancelAt = async (bookingId: number) => {
    const rows = await prismock.flowkoBookingAction.findMany({
      where: { bookingId, action: "CANCELLED" },
      orderBy: { id: "asc" },
    });
    return rows[rows.length - 1].createdAt.toISOString();
  };
  /** A booking of Ana at `time` on Monday for a customer, then cancelled by the customer through the mail link. */
  const customerCancelled = async (time: string, reason: string | null) => {
    const id = await book(f.users.olga, {
      workerMemberId: f.members.ana,
      serviceIds: [f.services.mens],
      start: at(time),
      customer: { name: "Tina Rep", email: "tina@example.com" },
    });
    await cancelBusinessBookingAsCustomer(db, { uid: await uidOf(id), reason, sessionUserId: null }, NOW, {
      sendMails: false,
    });
    return id;
  };

  it("a customer cancel: cancelled.by customer, at = the action's time, the reason, flags all false", async () => {
    const id = await customerCancelled("13:00", "  Zbolela sem  ");
    const row = rowOf(await day(f.users.olga), id);
    expect(row.status).toBe(BookingStatus.CANCELLED);
    expect(row.cancelled).toEqual({ by: "customer", at: await latestCancelAt(id) });
    expect(row.cancelReason).toBe("Zbolela sem");
    expect(flags(row)).toEqual({ mayCancel: false, mayMove: false, mayNoShow: false, mayReenter: false });
    expect(row.actions.map((a) => [a.kind, a.byCustomer])).toEqual([
      ["CREATED", false],
      ["CANCELLED", true],
    ]);
    expect(row.actions[1]).toMatchObject({ actorName: "Tina Rep", details: null });
  });

  it("a desk cancel: cancelled.by desk; no reason → cancelReason null", async () => {
    await cancelBusinessBooking(db, f.users.olga, { bookingId: f.bookings.bor }, NOW, { sendMails: false });
    const row = rowOf(await day(f.users.olga), f.bookings.bor);
    expect(row.cancelled).toEqual({ by: "desk", at: await latestCancelAt(f.bookings.bor) });
    expect(row.cancelReason).toBeNull();
    expect(row.actions.map((a) => [a.kind, a.actorName, a.byCustomer])).toEqual([
      ["CREATED", "Olga", false],
      ["CANCELLED", "Olga", false],
    ]);
    expect(flags(row)).toEqual({ mayCancel: false, mayMove: false, mayNoShow: false, mayReenter: false });
  });

  it("the legacy row (CANCELLED, no CANCELLED action): by desk, at null; its stored reason shows", async () => {
    await prismock.booking.update({
      where: { id: f.bookings.cancelled },
      data: { cancellationReason: "Staro" },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.cancelled);
    expect(row.cancelled).toEqual({ by: "desk", at: null });
    expect(row.cancelReason).toBe("Staro");
    expect(flags(row)).toEqual({ mayCancel: false, mayMove: false, mayNoShow: false, mayReenter: false });
  });

  it("a CANCELLED action without details.by but with actorMemberId null (pre-U29e customer) → customer", async () => {
    // Known limit (Task 12): a member-deleted desk action (actorMemberId SetNull, no details.by) reads the same.
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Marija Novak",
        actorMemberId: null,
      },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.cancelled);
    expect(row.cancelled).toEqual({ by: "customer", at: await latestCancelAt(f.bookings.cancelled) });
    expect(row.actions.map((a) => [a.kind, a.byCustomer])).toEqual([
      ["CREATED", false],
      ["CANCELLED", true],
    ]);
  });

  it("the latest CANCELLED action decides (a member's after an older customer one → desk)", async () => {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Marija Novak",
        createdAt: new Date(Date.now() - 60_000),
        details: { by: "customer" },
      },
    });
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Olga",
        actorMemberId: f.members.olga,
        createdAt: new Date(Date.now() + 60_000),
      },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.cancelled);
    expect(row.cancelled?.by).toBe("desk");
    expect(row.cancelled?.at).toBe(await latestCancelAt(f.bookings.cancelled));
  });

  it("details.by customer wins over a member id (a customer's cancel stays the customer's)", async () => {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Marija Novak",
        actorMemberId: f.members.olga,
        details: { by: "customer" },
      },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.cancelled);
    expect(row.cancelled?.by).toBe("customer");
    expect(row.actions[1].byCustomer).toBe(true);
    expect(row.actions[1].details).toBeNull();
  });

  it("a public CREATED action (no member) is byCustomer; member actions are not", async () => {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.ana,
        businessId: f.a,
        action: "CREATED",
        actorName: "Splet",
        actorMemberId: null,
      },
    });
    const row = rowOf(await day(f.users.olga), f.bookings.ana);
    expect(row.actions.map((a) => [a.actorName, a.byCustomer])).toEqual([
      ["Olga", false],
      ["Splet", true],
    ]);
  });

  it("a hand-over cancel (R10 marker) is not on the day; an ordinary cancel at the same time is", async () => {
    const reentered = await book(f.users.olga, {
      workerMemberId: f.members.ana,
      serviceIds: [f.services.mens],
      start: at("14:00"),
      customer: PETRA,
    });
    await cancelBusinessBooking(
      db,
      f.users.olga,
      { bookingId: reentered, reason: "Prestavljeno k: Bor", handoverToMemberId: f.members.bor },
      NOW,
      { sendMails: false }
    );
    const view = await day(f.users.olga);
    expect(view.days[0].bookings.some((b) => b.bookingId === reentered)).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Prestavljeno");
    await cancelBusinessBooking(db, f.users.olga, { bookingId: f.bookings.bor }, NOW, { sendMails: false });
    expect(rowOf(await day(f.users.olga), f.bookings.bor).cancelled?.by).toBe("desk");
  });

  it("a hand-over marker on an older CANCELLED action does not hide a later ordinary cancel", async () => {
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Olga",
        actorMemberId: f.members.olga,
        createdAt: new Date(Date.now() - 60_000),
        details: { handoverToMemberId: f.members.bor },
      },
    });
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Olga",
        actorMemberId: f.members.olga,
        createdAt: new Date(Date.now() + 60_000),
      },
    });
    expect(rowOf(await day(f.users.olga), f.bookings.cancelled).cancelled?.by).toBe("desk");
  });

  it("a LOCKED member with only a cancelled booking that day: no extra column, the row dropped", async () => {
    await cancelBusinessBooking(db, f.users.olga, { bookingId: f.bookings.dan }, NOW, { sendMails: false });
    const view = await day(f.users.olga);
    expect(view.days[0].columns.some((c) => c.memberId === f.members.dan)).toBe(false);
    expect(view.days[0].bookings.some((b) => b.bookingId === f.bookings.dan)).toBe(false);
    expect(view.days[0].bookings.some((b) => b.memberId === f.members.dan)).toBe(false);
  });

  it("a LOCKED member with a live and a cancelled booking: column kept, both rows", async () => {
    const danMirror = await prismock.flowkoWorkerMirror.findUnique({ where: { memberId: f.members.dan } });
    const danCancelled = await insertBooking({
      userId: f.users.dan,
      eventTypeId: danMirror?.eventTypeId ?? null,
      businessId: f.a,
      start: at("12:00"),
      end: at("12:30"),
      status: BookingStatus.CANCELLED,
      attendee: { name: "Janez Dolenc", email: "janez@example.com" },
    });
    const view = await day(f.users.olga);
    expect(columnOf(view, f.members.dan).locked).toBe(true);
    expect(rowOf(view, danCancelled).cancelled).toEqual({ by: "desk", at: null });
    expect(rowOf(view, f.bookings.dan).cancelled).toBeNull();
  });

  it("cancelReason only on cancelled rows (a live row with a stored reason answers null)", async () => {
    await prismock.booking.update({ where: { id: f.bookings.ana }, data: { cancellationReason: "x" } });
    expect(rowOf(await day(f.users.olga), f.bookings.ana).cancelReason).toBeNull();
  });

  it("deep scan: no actorMemberId, handoverToMemberId, `by` or details beyond the whitelist in the answer", async () => {
    await customerCancelled("13:00", "Ne morem");
    await cancelBusinessBooking(db, f.users.olga, { bookingId: f.bookings.bor }, NOW, { sendMails: false });
    await prismock.flowkoBookingAction.create({
      data: {
        bookingId: f.bookings.cancelled,
        businessId: f.a,
        action: "CANCELLED",
        actorName: "Olga",
        actorMemberId: f.members.olga,
        details: { by: "desk", secret: "s", fromStart: "x" },
      },
    });
    for (const userId of [f.users.olga, f.users.rok, f.users.ana]) {
      const view = await day(userId);
      const keys: string[] = [];
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value !== null && typeof value === "object") {
          for (const [k, v] of Object.entries(value)) {
            keys.push(k);
            walk(v);
          }
        }
      };
      walk(view);
      for (const banned of ["actorMemberId", "handoverToMemberId", "secret", "cancellationReason"]) {
        expect(keys).not.toContain(banned);
      }
      for (const b of view.days.flatMap((d) => d.bookings)) {
        for (const a of b.actions) {
          expect(Object.keys(a).sort()).toEqual(["actorName", "at", "byCustomer", "details", "kind"]);
          if (a.details) {
            expect(
              Object.keys(a.details).every((k) => ["fromStart", "toStart", "overrides", "noShow"].includes(k))
            ).toBe(true);
          }
        }
        if (b.cancelled) expect(Object.keys(b.cancelled).sort()).toEqual(["at", "by"]);
      }
      await expectNoPrivateData(view);
    }
  });

  it("the cancelled phone-only customer: e-mail null as on live rows", async () => {
    const id = await book(f.users.olga, {
      workerMemberId: f.members.ana,
      serviceIds: [f.services.mens],
      start: at("13:30"),
      customer: { name: "Urban Les", phone: "070 300 400" },
    });
    await cancelBusinessBooking(db, f.users.olga, { bookingId: id }, NOW, { sendMails: false });
    const row = rowOf(await day(f.users.olga), id);
    expect(row.customer.email).toBeNull();
    expect(JSON.stringify(row)).not.toContain("@sms.cal.com");
  });
});

describe("getDeskDay: Google (R3)", () => {
  it("Google busy per column user (desk-only Cene and locked Dan not asked), merged into other busy", async () => {
    googleBusy.mockImplementation(async (userId) =>
      userId === f.users.ana
        ? { busy: [{ start: ms("14:00"), end: ms("14:30") }], unavailable: false }
        : { busy: [], unavailable: false }
    );
    const view = await day(f.users.olga);
    expect(googleBusy.mock.calls.map((c) => c[0]).sort()).toEqual(
      [f.users.olga, f.users.ana, f.users.bor].sort()
    );
    expect(googleBusy).toHaveBeenCalledWith(f.users.ana, {
      start: new Date("2026-11-15T23:00:00Z").getTime(),
      end: new Date("2026-11-16T23:00:00Z").getTime(),
    });
    expect(columnOf(view, f.members.ana)).toMatchObject({
      otherBusy: [{ start: ms("14:00"), end: ms("14:30") }],
      googleUnavailable: false,
    });
  });

  it("a failing Google (the whole-day failure shape) → googleUnavailable, only booking-derived busy", async () => {
    googleBusy.mockImplementation(async (userId, range) =>
      userId === f.users.olga ? { busy: [range], unavailable: true } : { busy: [], unavailable: false }
    );
    const view = await day(f.users.olga);
    expect(columnOf(view, f.members.olga)).toMatchObject({
      otherBusy: [{ start: ms("12:00"), end: ms("13:00") }],
      googleUnavailable: true,
    });
    expect(columnOf(view, f.members.ana).googleUnavailable).toBe(false);
  });

  it("a rejecting Google → googleUnavailable", async () => {
    googleBusy.mockImplementation(async (userId) => {
      if (userId === f.users.bor) throw new Error("boom");
      return { busy: [], unavailable: false };
    });
    const view = await day(f.users.olga);
    expect(columnOf(view, f.members.bor)).toMatchObject({ otherBusy: [], googleUnavailable: true });
  });

  it("a Google that never answers → googleUnavailable after 3 s, the response still returned", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    googleBusy.mockImplementation((userId) =>
      userId === f.users.olga ? new Promise(() => undefined) : Promise.resolve({ busy: [], unavailable: false })
    );
    let settled = false;
    const pending = day(f.users.olga).then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(2_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const view = await pending;
    expect(columnOf(view, f.members.olga)).toMatchObject({
      otherBusy: [{ start: ms("12:00"), end: ms("13:00") }],
      googleUnavailable: true,
    });
    expect(columnOf(view, f.members.ana).googleUnavailable).toBe(false);
  });
});

describe("getDeskWeek (D2)", () => {
  const weekOf = (userId: number, memberId: number, weekStart = DATE) =>
    getDeskWeek(db, userId, { weekStart, memberId }, NOW, { googleBusy });

  it("Ana's week: 7 days, one column each, her rows only; one Google call for the week", async () => {
    const view = await weekOf(f.users.ana, f.members.ana);
    expect(view.days.map((d) => d.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    for (const d of view.days) {
      expect(d.columns.map((c) => c.memberId)).toEqual([f.members.ana]);
      expect(d.bookings.every((b) => b.memberId === f.members.ana)).toBe(true);
    }
    expect(view.days[0].bookings.map((b) => b.bookingId)).toEqual([f.bookings.ana]);
    // Flowko U29e: E6, R9 — the week never carries a cancelled row (Ana's cancelled 12:00 is on this Monday).
    const weekRows = view.days.flatMap((d) => d.bookings);
    expect(weekRows.every((b) => b.status !== BookingStatus.CANCELLED && b.cancelled === null)).toBe(true);
    expect(view.days[5].columns[0].shifts).toEqual([]); // Saturday off
    expect(googleBusy).toHaveBeenCalledTimes(1);
    expect(googleBusy).toHaveBeenCalledWith(f.users.ana, {
      start: new Date("2026-11-15T23:00:00Z").getTime(),
      end: new Date("2026-11-22T23:00:00Z").getTime(),
    });
  });

  it("Google busy of the week lands on its day only", async () => {
    googleBusy.mockImplementation(async () => ({
      busy: [{ start: ms("10:00", TUE), end: ms("11:00", TUE) }],
      unavailable: false,
    }));
    const view = await weekOf(f.users.olga, f.members.ana);
    expect(view.days[0].columns[0].otherBusy).toEqual([]);
    expect(view.days[1].columns[0].otherBusy).toEqual([{ start: ms("10:00", TUE), end: ms("11:00", TUE) }]);
  });

  it("a Tuesday weekStart → bad_roster; B's member → forbidden; staff Rok → bad_member", async () => {
    await expectCode(weekOf(f.users.ana, f.members.ana, TUE), "bad_roster");
    await expectCode(weekOf(f.users.olga, f.members.zala), "forbidden");
    await expectCode(weekOf(f.users.olga, 999_999), "forbidden");
    await expectCode(weekOf(f.users.olga, f.members.rok), "bad_member");
    await expectCode(weekOf(await makeUser("Stranger"), f.members.ana), "forbidden");
  });

  it("LOCKED Dan's week: his locked column only, his rows with cancel only", async () => {
    const view = await weekOf(f.users.olga, f.members.dan);
    for (const d of view.days) {
      expect(d.columns.map((c) => [c.memberId, c.locked])).toEqual([[f.members.dan, true]]);
    }
    expect(view.days[0].bookings.map((b) => b.bookingId)).toEqual([f.bookings.dan]);
    expect(flags(view.days[0].bookings[0])).toEqual({
      mayCancel: true,
      mayMove: false,
      mayNoShow: false,
      mayReenter: true,
    });
    expect(googleBusy).not.toHaveBeenCalled();
  });

  it("desk-only Cene's week: no Google call", async () => {
    const view = await weekOf(f.users.olga, f.members.cene);
    expect(view.days[1].bookings).toHaveLength(1);
    expect(googleBusy).not.toHaveBeenCalled();
  });
});

describe("listDeskServices and listDeskMembers", () => {
  it("services in position order with steps, total minutes and their workers", async () => {
    const services = await listDeskServices(db, f.users.ana);
    const stored = await prismock.flowkoService.findMany({
      where: { businessId: f.a },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect(services.map((s) => s.id)).toEqual(stored.map((s) => s.id));
    const colouring = services.find((s) => s.id === f.services.colouring);
    expect(colouring).toMatchObject({ name: "Barvanje", totalMinutes: 100 });
    expect(colouring?.steps.map((s) => s.kind)).toEqual(["busy", "processing", "busy"]);
    // The template assigns every service to the owner (createBusiness); ascending member ids.
    const asc = (ids: number[]) => [...ids].sort((x, y) => x - y);
    expect(colouring?.workerMemberIds).toEqual(asc([f.members.olga, f.members.ana, f.members.cene, f.members.dan]));
    expect(services.find((s) => s.id === f.services.mens)?.workerMemberIds).toEqual(
      asc([f.members.olga, f.members.ana, f.members.bor, f.members.cene, f.members.dan])
    );
    // Flowko U29e: E8 — priceCents.
    expect(Object.keys(services[0]).sort()).toEqual(
      ["category", "id", "name", "priceCents", "steps", "totalMinutes", "workerMemberIds"].sort()
    );
    const ofB = await listDeskServices(db, f.users.zala);
    expect(ofB.length).toBeGreaterThan(0);
    expect(ofB.some((s) => stored.some((a) => a.id === s.id))).toBe(false);
    expect(ofB.every((s) => s.workerMemberIds.every((id) => id === f.members.zala))).toBe(true);
  });

  // Flowko U29c: P4 — a corrupt row is skipped and logged once with the service id only, never a throw.
  it("a service with corrupt steps is omitted and logged once with its id only; the others are intact", async () => {
    const logError = vi
      .spyOn(Object.getPrototypeOf(logger) as { error: (...args: unknown[]) => unknown }, "error")
      .mockImplementation(() => undefined);
    const before = await listDeskServices(db, f.users.ana);
    await prismock.flowkoService.update({ where: { id: f.services.colouring }, data: { steps: { x: 1 } } });
    const services = await listDeskServices(db, f.users.ana);
    const expected = before.filter((s) => s.id !== f.services.colouring);
    expect(services).toEqual(expected);
    expect(services.length).toBeGreaterThan(0);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logError.mock.calls[0])).toContain(String(f.services.colouring));
    expect(JSON.stringify(logError.mock.calls[0])).not.toContain("Barvanje");
  });

  it("members: ACTIVE only (Rok, Cene and Recepcija included, Dan not), position order, no userId", async () => {
    const members = await listDeskMembers(db, f.users.ana);
    expect(members.map((m) => m.displayName)).toEqual(["Olga", "Ana", "Bor", "Rok", "Cene", "Recepcija"]);
    expect(members.find((m) => m.memberId === f.members.cene)).toEqual({
      memberId: f.members.cene,
      displayName: "Cene",
      role: FlowkoBusinessRole.WORKER,
      hasColumn: true,
      deskOnly: true,
    });
    expect(members.find((m) => m.memberId === f.members.rok)).toMatchObject({
      role: FlowkoBusinessRole.STAFF,
      hasColumn: false,
      deskOnly: false,
    });
  });

  it("a stranger → forbidden", async () => {
    const stranger = await makeUser("Stranger");
    await expectCode(listDeskServices(db, stranger), "forbidden");
    await expectCode(listDeskMembers(db, stranger), "forbidden");
  });
});

describe("findCustomers (R11)", () => {
  const find = (query: string, userId = f.users.ana) => findCustomers(db, userId, { query });

  it("„mar“ finds Marija Novak once (3 bookings, same name/phone/e-mail; a cancelled one counts)", async () => {
    expect(await find("mar")).toEqual([
      { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
    ]);
    expect(await find("  NOVAK ")).toHaveLength(1);
  });

  it("a 4th booking with a new phone → two results, newest first", async () => {
    await book(f.users.olga, {
      workerMemberId: f.members.cene,
      serviceIds: [f.services.mens],
      start: at("11:00", TUE),
      customer: { ...MARIJA, phone: "040 999 888" },
    });
    expect(await find("marija")).toEqual([
      { name: "Marija Novak", phone: "+38640999888", email: "marija@example.com" },
      { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
    ]);
  });

  it("phone digits: „041 12“ finds +38641123456; a phone-only customer's e-mail is null", async () => {
    expect(await find("041 12")).toEqual([
      { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
    ]);
    expect(await find("031 555")).toEqual([{ name: "Petra Kos", phone: "+38631555666", email: null }]);
    expect(await find("Petra")).toEqual([{ name: "Petra Kos", phone: "+38631555666", email: null }]);
  });

  it("too short: „a“, „04“, „“ → []", async () => {
    expect(await find("a")).toEqual([]);
    expect(await find("04")).toEqual([]);
    expect(await find("   ")).toEqual([]);
  });

  it("business B's customer never appears; Zala sees her own only", async () => {
    expect(await find("mara")).toEqual([]);
    expect(await find("040 111")).toEqual([]);
    expect(await find("mara", f.users.zala)).toEqual([
      { name: "Mara Bistra", phone: "+38640111222", email: "mara@example.com" },
    ]);
    expect(await find("marija", f.users.zala)).toEqual([]);
  });

  it("Olga's own Cal booking's attendee is never a customer", async () => {
    expect(await find("zasebna")).toEqual([]);
  });

  it("max 8", async () => {
    const mirror = await prismock.flowkoWorkerMirror.findUnique({ where: { memberId: f.members.ana } });
    for (let i = 0; i < 10; i += 1) {
      await insertBooking({
        userId: f.users.ana,
        eventTypeId: mirror?.eventTypeId ?? null,
        businessId: f.a,
        start: at("14:00", "2026-11-18"),
        end: at("14:30", "2026-11-18"),
        status: BookingStatus.CANCELLED,
        attendee: { name: `Testna Stranka ${i}`, email: `t${i}@example.com` },
      });
    }
    const found = await find("testna");
    expect(found).toHaveLength(8);
    expect(found[0].name).toBe("Testna Stranka 9");
  });

  it("a stranger → forbidden", async () => {
    await expectCode(find("marija", await makeUser("Stranger")), "forbidden");
  });

  // Flowko U29e: E10.5, R21. The name filter is literal: % _ and \ reach Postgres escaped (the wildcard behaviour
  // itself is proven on Postgres in desk.integration-test.ts; prismock's `contains` is a literal indexOf).
  it("„m_rija“ finds nothing (regression belt) and the name filter carries the escaped text", async () => {
    expect(await find("m_rija")).toEqual([]);
    expect(await find("ma%k")).toEqual([]);
    const spy = vi.spyOn(prismock.attendee, "findMany");
    await find("m_rija");
    await find("ab 50%");
    await find("a\\b");
    const contains = spy.mock.calls.map(
      (c) => (c[0] as { where: { name?: { contains: string } } }).where.name?.contains
    );
    spy.mockRestore();
    expect(contains).toEqual(["m\\_rija", "ab 50\\%", "a\\\\b"]);
  });

  it("a phone search does not touch the name filter", async () => {
    const spy = vi.spyOn(prismock.attendee, "findMany");
    await find("041 12");
    const where = (spy.mock.calls[0][0] as { where: { name?: unknown } }).where;
    spy.mockRestore();
    expect(where.name).toBeUndefined();
  });
});

// Flowko U29e: E8, R15, R16 — the price reaches the desk's service list only (every desk role books), never a
// booking row, the booking itself, its steps or actions, or the worker's mirror EventType.
describe("E8: the price on the desk (Flowko U29e)", () => {
  const PRICE = 98_765; // 987,65 €: digits that appear nowhere else in the fixture (phones, times, ids)
  const priceKey = /price/i;

  /** Saves Barvanje through the owner's editor with PRICE (the ACTIVE members who do it today). */
  async function priceColouring(priceCents: number | null): Promise<void> {
    const row = await prismock.flowkoService.findUnique({
      where: { id: f.services.colouring },
      select: { name: true, category: true, steps: true },
    });
    if (!row) throw new Error("fixture: Barvanje missing");
    await saveService(db, f.users.olga, {
      id: f.services.colouring,
      name: row.name,
      category: row.category,
      steps: row.steps as never,
      workerMemberIds: [f.members.olga, f.members.ana, f.members.cene],
      priceCents,
    });
  }

  /** Every key of `value` (deep) that names a price, and every string with the price's digits. */
  function priceTraces(value: unknown): string[] {
    const found: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === "string") {
        if (v.includes("987,65") || v.includes(String(PRICE))) found.push(`${path}: text`);
        return;
      }
      if (typeof v === "number") {
        if (v === PRICE) found.push(`${path}: number`);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${path}[${i}]`));
        return;
      }
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        for (const [key, x] of Object.entries(v)) {
          if (priceKey.test(key)) found.push(`${path}.${key}: key`);
          walk(x, `${path}.${key}`);
        }
      }
    };
    walk(value, "$");
    return found;
  }

  it("listDeskServices answers priceCents to the owner, a worker and staff; unpriced → null", async () => {
    await priceColouring(PRICE);
    for (const userId of [f.users.olga, f.users.ana, f.users.rok]) {
      const services = await listDeskServices(db, userId);
      expect(services.find((s) => s.id === f.services.colouring)?.priceCents).toBe(PRICE);
      expect(services.find((s) => s.id === f.services.mens)?.priceCents).toBeNull();
    }
  });

  it("the read guard: a stored -5, 1_000_000 or 10_000_000 reads as null; 0 stays 0", async () => {
    const set = (id: number, priceCents: number) =>
      prismock.flowkoService.update({ where: { id }, data: { priceCents } });
    await set(f.services.colouring, -5);
    await set(f.services.mens, 10_000_000);
    let services = await listDeskServices(db, f.users.ana);
    expect(services.find((s) => s.id === f.services.colouring)?.priceCents).toBeNull();
    expect(services.find((s) => s.id === f.services.mens)?.priceCents).toBeNull();
    await set(f.services.colouring, 1_000_000);
    await set(f.services.mens, 0);
    services = await listDeskServices(db, f.users.ana);
    expect(services.find((s) => s.id === f.services.colouring)?.priceCents).toBeNull();
    expect(services.find((s) => s.id === f.services.mens)?.priceCents).toBe(0);
  });

  it("deep scan: the day and week answers carry no price key and no price value", async () => {
    await priceColouring(PRICE);
    await prismock.flowkoService.update({ where: { id: f.services.mens }, data: { priceCents: PRICE } });
    // The walk finds the price where it belongs (the services answer), so an empty result below means something.
    expect(priceTraces(await listDeskServices(db, f.users.olga)).length).toBeGreaterThan(0);
    for (const userId of [f.users.olga, f.users.rok, f.users.ana]) {
      const dayView = await day(userId, at("09:10"));
      // The day has rows with both priced services (Ana's Barvanje, Bor's and Dan's Moško, the cancelled one).
      expect(dayView.days[0].bookings.length).toBeGreaterThan(3);
      expect(priceTraces(dayView)).toEqual([]);
      for (const memberId of [f.members.ana, f.members.dan]) {
        const weekView = await getDeskWeek(db, userId, { weekStart: DATE, memberId }, NOW, { googleBusy });
        expect(priceTraces(weekView)).toEqual([]);
      }
    }
  });

  it("createBusinessBooking with a priced service writes no price: booking, title, steps, actions as unpriced", async () => {
    await priceColouring(PRICE);
    const priced = await book(f.users.olga, {
      workerMemberId: f.members.ana,
      serviceIds: [f.services.colouring],
      start: at("09:00", TUE),
      customer: MARIJA,
    });
    const read = async (id: number) => {
      const booking = await prismock.booking.findUnique({ where: { id } });
      const steps = await prismock.flowkoBookingStep.findMany({
        where: { bookingId: id },
        orderBy: { index: "asc" },
      });
      const actions = await prismock.flowkoBookingAction.findMany({ where: { bookingId: id } });
      const attendees = await prismock.attendee.findMany({ where: { bookingId: id } });
      const payments = await prismock.payment.findMany({ where: { bookingId: id } });
      return { booking, steps, actions, attendees, payments };
    };
    const withPrice = await read(priced);
    const baseline = await read(f.bookings.ana); // the same service, worker and customer, booked unpriced
    expect(withPrice.booking?.title).toBe(baseline.booking?.title);
    expect(withPrice.booking?.paid).toBe(false);
    expect(withPrice.payments).toEqual([]);
    expect(withPrice.steps.map((s) => s.serviceName)).toEqual(baseline.steps.map((s) => s.serviceName));
    expect(withPrice.steps.map((s) => Object.keys(s).sort())).toEqual(
      baseline.steps.map((s) => Object.keys(s).sort())
    );
    // The uid is random text: left out of the value scan (keys are still scanned).
    const { uid: _uid, ...bookingWithoutUid } = withPrice.booking ?? { uid: "" };
    expect(priceTraces({ ...withPrice, booking: bookingWithoutUid })).toEqual([]);
  });

  it("the mirror EventTypes keep price 0, currency and no metadata.apps after a priced save and booking", async () => {
    const mirrorEventTypes = async () => {
      const mirrors = await prismock.flowkoWorkerMirror.findMany({ where: { businessId: f.a } });
      const rows = await prismock.eventType.findMany({
        where: { id: { in: mirrors.map((m) => m.eventTypeId) } },
        select: { id: true, price: true, currency: true, metadata: true },
        orderBy: { id: "asc" },
      });
      return rows;
    };
    const before = await mirrorEventTypes();
    expect(before.length).toBeGreaterThan(0);
    await priceColouring(PRICE);
    await book(f.users.olga, {
      workerMemberId: f.members.ana,
      serviceIds: [f.services.colouring],
      start: at("09:00", TUE),
      customer: MARIJA,
    });
    const after = await mirrorEventTypes();
    expect(after).toEqual(before);
    for (const row of after) {
      expect(row.price).toBe(0);
      expect((row.metadata as Record<string, unknown> | null)?.apps).toBeUndefined();
      expect(priceTraces(row.metadata)).toEqual([]);
    }
  });
});

describe("RF1: no uid, userId, worker e-mail or placeholder in any response", () => {
  it("day, week, services, members and customers for owner, staff and worker", async () => {
    // Cene's placeholder address would leak through a desk-only attendee or member; a customer e-mail is fine.
    for (const userId of [f.users.olga, f.users.rok, f.users.ana]) {
      await expectNoPrivateData(await day(userId, at("09:10")));
      await expectNoPrivateData(
        await getDeskWeek(db, userId, { weekStart: DATE, memberId: f.members.ana }, NOW, { googleBusy })
      );
      await expectNoPrivateData(
        await getDeskWeek(db, userId, { weekStart: DATE, memberId: f.members.dan }, NOW, { googleBusy })
      );
      await expectNoPrivateData(await listDeskServices(db, userId));
      await expectNoPrivateData(await listDeskMembers(db, userId));
      await expectNoPrivateData(await findCustomers(db, userId, { query: "mar" }));
      const byPhone = await findCustomers(db, userId, { query: "0315" });
      expect(byPhone).not.toHaveLength(0);
      await expectNoPrivateData(byPhone);
    }
  });

  it("the walk itself catches a uid substring and a userId key", async () => {
    const booking = await prismock.booking.findUnique({ where: { id: f.bookings.ana }, select: { uid: true } });
    await expect(expectNoPrivateData({ link: `https://x/booking/${booking?.uid}` })).rejects.toThrow();
    await expect(expectNoPrivateData({ nested: [{ userId: 1 }] })).rejects.toThrow();
    await expect(expectNoPrivateData({ e: "cene@flowko.invalid" })).rejects.toThrow();
  });
});
