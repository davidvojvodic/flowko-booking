// Flowko U27: cancel (staff W7, customer W8) and move (W9) of business bookings on prismock. The fixture is
// bookingWriter.test.ts's: business A (owner Olga, login workers Ana, Bor and Dan (LOCKED after his booking is
// written), desk-only worker Cene, staff Rok) and B (owner Zala, worker Bea); usual weeks Mon–Fri 07–15 (Bor
// 12–20). Prismock ignores the idempotency extension, unique keys and $executeRaw: the lock is an injected vi.fn,
// and the real lock, key and P2002 are proven on Postgres (bookingWriter.integration-test.ts). The mail module is
// mocked; the writer's after-commit helper is exercised with throwing senders.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { IdempotencyKeyService } from "@calcom/lib/idempotencyKey/idempotencyKeyService";
import logger from "@calcom/lib/logger";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { cancelBusinessBooking, cancelBusinessBookingAsCustomer, moveBusinessBooking } from "./bookingChange";
import * as bookingMail from "./bookingMail";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
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
const NOW = new Date("2026-11-09T06:00:00Z"); // Mon 07:00 in Ljubljana
const DATE = "2026-11-16"; // a Monday
const at = (time: string) => new Date(wallClockToMs(DATE, time, TZ));
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
  users: { olga: number; ana: number; bor: number; rok: number; dan: number; zala: number; bea: number };
  members: { olga: number; ana: number; bor: number; cene: number; dan: number; rok: number; zala: number };
  services: Record<"mens" | "colouring", number>;
  /** Ana Barvanje 09:00–10:40, phone-only customer Marija Novak. */
  ana: { bookingId: number; uid: string };
  /** Bor men's cut 13:00–13:30. */
  bor: { bookingId: number; uid: string };
  /** Dan (LOCKED after it was written) Barvanje 09:00. */
  dan: { bookingId: number; uid: string };
  /** Olga's own booking on an ordinary event type (not a business booking). */
  olgaPlain: number;
};

let lockWorker: ReturnType<typeof vi.fn<NonNullable<WriterDeps["lockWorker"]>>>;
let googleBusy: ReturnType<typeof vi.fn<NonNullable<WriterDeps["googleBusy"]>>>;

function bookingInput(over: Partial<CreateBookingInput>): CreateBookingInput {
  return {
    workerMemberId: 0,
    serviceIds: [],
    start: at("09:00"),
    customer: { name: "Marija Novak", phone: "041 123 456" },
    confirmOverride: false,
    ...over,
  };
}

async function book(actorUserId: number, over: Partial<CreateBookingInput>) {
  const result = await createBusinessBooking(db, actorUserId, bookingInput(over), NOW, {
    lockWorker,
    googleBusy,
    sendMails: false,
  });
  if (result.status !== "created")
    throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  return { bookingId: result.bookingId, uid: result.uid };
}

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `bc-a-${seq}`,
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
    slug: `bc-b-${seq}`,
    templateId: "hair-salon",
  });
  const bea = await makeUser("Bea");
  await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

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

  const anaBooking = await book(olga, { workerMemberId: anaMember.memberId, serviceIds: [ids.colouring] });
  const borBooking = await book(olga, {
    workerMemberId: borMember.memberId,
    serviceIds: [ids.mens],
    start: at("13:00"),
  });
  const danBooking = await book(olga, { workerMemberId: danMember.memberId, serviceIds: [ids.colouring] });
  // Dan is locked after his set-up and his booking (a locked worker keeps both).
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
      startTime: at("12:00"),
      endTime: at("12:30"),
      status: BookingStatus.ACCEPTED,
      user: { connect: { id: olga } },
      eventType: { connect: { id: plainType.id } },
    },
    select: { id: true },
  });

  return {
    a,
    users: { olga, ana, bor, rok, dan, zala, bea },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      dan: danMember.memberId,
      rok: rokMember.memberId,
      zala: createdB.ownerMemberId,
    },
    services: ids,
    ana: anaBooking,
    bor: borBooking,
    dan: danBooking,
    olgaPlain: plain.id,
  };
}

let f: Fixture;
const mail = {
  created: vi.mocked(bookingMail.sendBusinessBookingCreated),
  moved: vi.mocked(bookingMail.sendBusinessBookingMoved),
  cancelled: vi.mocked(bookingMail.sendBusinessBookingCancelled),
};
/** Every sub-logger is a tslog Logger: the prototype's error catches the writer's log line. */
let logError: MockInstance<(...args: unknown[]) => unknown>;

beforeEach(async () => {
  lockWorker = vi.fn(async () => undefined);
  googleBusy = vi.fn(async () => ({ busy: [], unavailable: false }));
  f = await setUp();
  lockWorker.mockClear();
  googleBusy.mockClear();
  for (const m of Object.values(mail)) m.mockReset();
  logError = vi
    .spyOn(Object.getPrototypeOf(logger) as { error: (...args: unknown[]) => unknown }, "error")
    .mockImplementation(() => undefined);
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

const bookingOf = (id: number) => prismock.booking.findUnique({ where: { id } });
const stepsOf = (bookingId: number) =>
  prismock.flowkoBookingStep.findMany({ where: { bookingId }, orderBy: { index: "asc" } });
const actionsOf = (bookingId: number) =>
  prismock.flowkoBookingAction.findMany({ where: { bookingId }, orderBy: { id: "asc" } });
const stepTimes = async (bookingId: number) =>
  (await stepsOf(bookingId)).map((s) => [
    s.index,
    s.kind,
    s.startTime,
    s.endTime,
    s.serviceId,
    s.serviceName,
  ]);

const cancel = (actorUserId: number, bookingId: number, now = NOW, extra: { reason?: string | null } = {}) =>
  cancelBusinessBooking(db, actorUserId, { bookingId, ...extra }, now);
const cancelByUid = (uid: string, sessionUserId: number | null, now = NOW) =>
  cancelBusinessBookingAsCustomer(db, { uid, sessionUserId }, now);
const move = (
  actorUserId: number,
  bookingId: number,
  start: Date,
  over: { confirmOverride?: boolean; actorMemberId?: number } = {},
  deps: WriterDeps = {}
) =>
  moveBusinessBooking(
    db,
    actorUserId,
    { bookingId, start, confirmOverride: over.confirmOverride ?? false, actorMemberId: over.actorMemberId },
    NOW,
    { lockWorker, googleBusy, ...deps }
  );

describe("cancelBusinessBooking (W7, staff)", () => {
  it("Olga cancels Ana's booking: CANCELLED, cancelledBy null, iCalSequence +1, steps kept, CANCELLED action", async () => {
    const before = await bookingOf(f.ana.bookingId);
    const stepsBefore = await stepTimes(f.ana.bookingId);

    expect(await cancel(f.users.olga, f.ana.bookingId, NOW, { reason: "  Stranka je zbolela  " })).toEqual({
      status: "cancelled",
    });

    const after = await bookingOf(f.ana.bookingId);
    expect(after).toMatchObject({
      status: BookingStatus.CANCELLED,
      cancelledBy: null,
      cancellationReason: "Stranka je zbolela",
      iCalSequence: (before?.iCalSequence ?? 0) + 1,
      uid: f.ana.uid,
      startTime: at("09:00"),
    });
    expect(await stepTimes(f.ana.bookingId)).toEqual(stepsBefore);
    expect(stepsBefore).toHaveLength(3);
    const actions = await actionsOf(f.ana.bookingId);
    expect(actions.map((a) => a.action)).toEqual(["CREATED", "CANCELLED"]);
    expect(actions[1]).toMatchObject({
      businessId: f.a,
      actorMemberId: f.members.olga,
      actorName: "Olga",
      userId: f.users.olga,
      details: null,
    });
    expect(mail.cancelled).toHaveBeenCalledTimes(1);
    expect(mail.cancelled).toHaveBeenCalledWith(f.ana.bookingId);
  });

  it("a second cancel → booking_not_active; one CANCELLED action only", async () => {
    await cancel(f.users.olga, f.ana.bookingId);
    await expectCode(cancel(f.users.olga, f.ana.bookingId), "booking_not_active");
    const actions = await actionsOf(f.ana.bookingId);
    expect(actions.filter((a) => a.action === "CANCELLED")).toHaveLength(1);
    expect((await bookingOf(f.ana.bookingId))?.iCalSequence).toBe(1);
  });

  it("a booking that ended → booking_not_active", async () => {
    await expectCode(cancel(f.users.olga, f.ana.bookingId, at("10:40")), "booking_not_active");
    expect((await bookingOf(f.ana.bookingId))?.status).toBe(BookingStatus.ACCEPTED);
  });

  it("a booking that has started may still be cancelled by staff", async () => {
    expect(await cancel(f.users.olga, f.ana.bookingId, at("09:10"))).toEqual({ status: "cancelled" });
  });

  it("Olga's own booking on an ordinary event type → not_business_booking", async () => {
    await expectCode(cancel(f.users.olga, f.olgaPlain), "not_business_booking");
    expect((await bookingOf(f.olgaPlain))?.status).toBe(BookingStatus.ACCEPTED);
  });

  it("Ana cancels Bor's → forbidden; Zala → forbidden; 999999 → forbidden", async () => {
    await expectCode(cancel(f.users.ana, f.bor.bookingId), "forbidden");
    await expectCode(cancel(f.users.zala, f.ana.bookingId), "forbidden");
    await expectCode(cancel(f.users.olga, 999_999), "forbidden");
    expect((await bookingOf(f.bor.bookingId))?.status).toBe(BookingStatus.ACCEPTED);
    expect((await bookingOf(f.ana.bookingId))?.status).toBe(BookingStatus.ACCEPTED);
  });

  it("Dan's booking (LOCKED worker) is cancelled by Olga", async () => {
    expect(await cancel(f.users.olga, f.dan.bookingId)).toEqual({ status: "cancelled" });
    expect((await bookingOf(f.dan.bookingId))?.status).toBe(BookingStatus.CANCELLED);
  });

  it("Ana cancels her own; Rok (staff) cancels Bor's with actor Recepcija", async () => {
    await cancel(f.users.ana, f.ana.bookingId);
    expect((await actionsOf(f.ana.bookingId))[1]).toMatchObject({ actorMemberId: f.members.ana });
    const recepcija = await prismock.flowkoBusinessMember.findFirst({ where: { displayName: "Recepcija" } });
    await cancelBusinessBooking(
      db,
      f.users.rok,
      { bookingId: f.bor.bookingId, actorMemberId: recepcija?.id },
      NOW
    );
    expect((await actionsOf(f.bor.bookingId))[1]).toMatchObject({
      actorMemberId: recepcija?.id,
      actorName: "Recepcija",
      userId: f.users.rok,
    });
  });

  it("a reason over 500 characters → bad_booking; nothing written", async () => {
    await expectCode(cancel(f.users.olga, f.ana.bookingId, NOW, { reason: "x".repeat(501) }), "bad_booking");
    expect((await bookingOf(f.ana.bookingId))?.status).toBe(BookingStatus.ACCEPTED);
    await cancel(f.users.olga, f.ana.bookingId, NOW, { reason: "x".repeat(500) });
    expect((await bookingOf(f.ana.bookingId))?.cancellationReason).toHaveLength(500);
  });
});

describe("cancelBusinessBookingAsCustomer (W8, the mail's link)", () => {
  it("no session: CANCELLED, actor = the customer (no member, the form's name, no user)", async () => {
    expect(await cancelByUid(f.ana.uid, null)).toEqual({ status: "cancelled" });
    expect(await bookingOf(f.ana.bookingId)).toMatchObject({
      status: BookingStatus.CANCELLED,
      cancelledBy: null,
    });
    expect((await actionsOf(f.ana.bookingId))[1]).toMatchObject({
      action: "CANCELLED",
      actorMemberId: null,
      actorName: "Marija Novak",
      userId: null,
    });
    expect(mail.cancelled).toHaveBeenCalledWith(f.ana.bookingId);
  });

  it("Ana's session on her own booking: the staff path, action by Ana's member", async () => {
    await cancelByUid(f.ana.uid, f.users.ana);
    expect((await actionsOf(f.ana.bookingId))[1]).toMatchObject({
      actorMemberId: f.members.ana,
      actorName: "Ana",
      userId: f.users.ana,
    });
  });

  it("Ana's session on Bor's booking → forbidden, the booking stays ACCEPTED", async () => {
    await expectCode(cancelByUid(f.bor.uid, f.users.ana), "forbidden");
    expect((await bookingOf(f.bor.bookingId))?.status).toBe(BookingStatus.ACCEPTED);
    expect(await actionsOf(f.bor.bookingId)).toHaveLength(1);
  });

  it("another business's owner (Zala) signed in is a customer here", async () => {
    await cancelByUid(f.ana.uid, f.users.zala);
    expect((await actionsOf(f.ana.bookingId))[1]).toMatchObject({
      actorMemberId: null,
      actorName: "Marija Novak",
      userId: f.users.zala,
    });
  });

  it("a booking that has started: customer → booking_not_active, staff → allowed", async () => {
    await expectCode(cancelByUid(f.ana.uid, null, at("09:00")), "booking_not_active");
    expect((await bookingOf(f.ana.bookingId))?.status).toBe(BookingStatus.ACCEPTED);
    expect(await cancel(f.users.olga, f.ana.bookingId, at("09:00"))).toEqual({ status: "cancelled" });
  });

  it("a uid that is no business booking (or unknown) → not_business_booking", async () => {
    await expectCode(cancelByUid(`plain-${seq}`, null), "not_business_booking");
    await expectCode(cancelByUid("no-such-uid", null), "not_business_booking");
  });
});

describe("moveBusinessBooking (W9)", () => {
  it("the 09:00 Barvanje to 09:15: moved in place, steps rewritten, reminders gone, RESCHEDULED action", async () => {
    await prismock.booking.update({
      where: { id: f.ana.bookingId },
      data: { rescheduled: false, fromReschedule: "earlier-uid", rescheduledBy: "earlier@example.com" },
    });
    await prismock.flowkoAttendeeReminder.create({
      data: { bookingId: f.ana.bookingId, offsetMinutes: 1440 },
    });
    await prismock.flowkoAttendeeReminder.create({
      data: { bookingId: f.bor.bookingId, offsetMinutes: 1440 },
    });

    const result = await move(f.users.olga, f.ana.bookingId, at("09:15"));
    expect(result).toEqual({ status: "moved", bookingId: f.ana.bookingId, uid: f.ana.uid });

    const after = await bookingOf(f.ana.bookingId);
    expect(after).toMatchObject({
      uid: f.ana.uid,
      status: BookingStatus.ACCEPTED,
      startTime: at("09:15"),
      endTime: at("10:55"),
      iCalSequence: 1,
      idempotencyKey: IdempotencyKeyService.generate({
        startTime: at("09:15"),
        endTime: at("10:55"),
        userId: f.users.ana,
      }),
      rescheduled: false,
      fromReschedule: "earlier-uid",
      rescheduledBy: "earlier@example.com",
      title: "Barvanje med Ana in Marija Novak",
    });
    expect(await stepTimes(f.ana.bookingId)).toEqual([
      [0, "busy", at("09:15"), at("09:45"), f.services.colouring, "Barvanje"],
      [1, "processing", at("09:45"), at("10:25"), f.services.colouring, "Barvanje"],
      [2, "busy", at("10:25"), at("10:55"), f.services.colouring, "Barvanje"],
    ]);
    expect(await prismock.flowkoAttendeeReminder.count({ where: { bookingId: f.ana.bookingId } })).toBe(0);
    expect(await prismock.flowkoAttendeeReminder.count({ where: { bookingId: f.bor.bookingId } })).toBe(1);

    const actions = await actionsOf(f.ana.bookingId);
    expect(actions.map((a) => a.action)).toEqual(["CREATED", "RESCHEDULED"]);
    expect(actions[1]).toMatchObject({
      businessId: f.a,
      actorMemberId: f.members.olga,
      actorName: "Olga",
      userId: f.users.olga,
      details: { fromStart: at("09:00").toISOString(), toStart: at("09:15").toISOString() },
    });
    expect(lockWorker).toHaveBeenCalledTimes(1);
    expect(lockWorker.mock.calls[0][1]).toBe(f.users.ana);
    expect(mail.moved).toHaveBeenCalledTimes(1);
    expect(mail.moved).toHaveBeenCalledWith(f.ana.bookingId);
  });

  it("a move onto a time that collides only with the booking itself → no overlaps_booking", async () => {
    // 09:45: busy 09:45–10:15 would overlap the booking's own busy step 10:10–10:40.
    const result = await move(f.users.olga, f.ana.bookingId, at("09:45"));
    expect(result.status).toBe("moved");
    expect((await bookingOf(f.ana.bookingId))?.startTime).toEqual(at("09:45"));
  });

  it("a collision with another booking → needs_confirm, nothing written; the override moves it", async () => {
    const cut = await book(f.users.olga, {
      workerMemberId: f.members.ana,
      serviceIds: [f.services.mens],
      start: at("09:30"),
    });
    const stepsBefore = await stepTimes(f.ana.bookingId);

    const refused = await move(f.users.olga, f.ana.bookingId, at("09:15"));
    expect(refused).toEqual({
      status: "needs_confirm",
      problems: [
        {
          kind: "overlaps_booking",
          step: 0,
          with: { start: at("09:30").getTime(), end: at("10:00").getTime() },
        },
      ],
    });
    expect((await bookingOf(f.ana.bookingId))?.startTime).toEqual(at("09:00"));
    expect(await stepTimes(f.ana.bookingId)).toEqual(stepsBefore);
    expect(await actionsOf(f.ana.bookingId)).toHaveLength(1);
    expect(mail.moved).not.toHaveBeenCalled();

    const moved = await move(f.users.olga, f.ana.bookingId, at("09:15"), { confirmOverride: true });
    expect(moved.status).toBe("moved");
    expect((await actionsOf(f.ana.bookingId))[1].details).toEqual({
      fromStart: at("09:00").toISOString(),
      toStart: at("09:15").toISOString(),
      overrides: ["overlaps_booking"],
    });
    expect((await bookingOf(cut.bookingId))?.startTime).toEqual(at("09:30"));
  });

  it("Dan's booking (LOCKED worker) → worker_locked", async () => {
    await expectCode(move(f.users.olga, f.dan.bookingId, at("09:15")), "worker_locked");
    expect(lockWorker).not.toHaveBeenCalled();
  });

  it("a CANCELLED booking → booking_not_active", async () => {
    await cancel(f.users.olga, f.ana.bookingId);
    await expectCode(move(f.users.olga, f.ana.bookingId, at("09:15")), "booking_not_active");
  });

  it("rights: Ana moves Bor's, Zala and 999999 → forbidden; Olga's plain booking → not_business_booking", async () => {
    await expectCode(move(f.users.ana, f.bor.bookingId, at("13:15")), "forbidden");
    await expectCode(move(f.users.zala, f.ana.bookingId, at("09:15")), "forbidden");
    await expectCode(move(f.users.olga, 999_999, at("09:15")), "forbidden");
    await expectCode(move(f.users.olga, f.olgaPlain, at("12:15")), "not_business_booking");
    expect(lockWorker).not.toHaveBeenCalled();
  });

  it("Ana moves her own booking; actor and user are Ana", async () => {
    await move(f.users.ana, f.ana.bookingId, at("09:15"));
    expect((await actionsOf(f.ana.bookingId))[1]).toMatchObject({
      actorMemberId: f.members.ana,
      userId: f.users.ana,
    });
  });

  it("crossing local midnight or an invalid start → bad_booking", async () => {
    await expectCode(
      move(f.users.olga, f.ana.bookingId, new Date("2026-11-16T22:00:00Z"), { confirmOverride: true }),
      "bad_booking"
    );
    await expectCode(move(f.users.olga, f.ana.bookingId, new Date("nope")), "bad_booking");
  });

  it("P2002 on the idempotency key → duplicate_time; no mail", async () => {
    vi.spyOn(prismock.booking, "updateMany").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["idempotencyKey"] },
      })
    );
    await expectCode(move(f.users.olga, f.ana.bookingId, at("09:15")), "duplicate_time");
    expect(mail.moved).not.toHaveBeenCalled();
  });
});

describe("mails after commit never undo the write (the writer's one helper)", () => {
  const writerLogLines = () =>
    logError.mock.calls.filter((call) => call[0] === "business booking mail not sent");

  it("create: a throwing sender → created, logged once with kind, id and error class", async () => {
    mail.created.mockRejectedValueOnce(new TypeError("boom"));
    const result = await createBusinessBooking(
      db,
      f.users.olga,
      bookingInput({ workerMemberId: f.members.ana, serviceIds: [f.services.mens], start: at("12:00") }),
      NOW,
      { lockWorker, googleBusy }
    );
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(writerLogLines()).toEqual([
      [
        "business booking mail not sent",
        { kind: "created", bookingId: result.bookingId, errorClass: "TypeError" },
      ],
    ]);
  });

  it("cancel: a throwing sender → cancelled, logged once", async () => {
    mail.cancelled.mockRejectedValueOnce(new Error("boom"));
    expect(await cancel(f.users.olga, f.ana.bookingId)).toEqual({ status: "cancelled" });
    expect(writerLogLines()).toEqual([
      [
        "business booking mail not sent",
        { kind: "cancelled", bookingId: f.ana.bookingId, errorClass: "Error" },
      ],
    ]);
  });

  it("move: a throwing sender → moved, logged once", async () => {
    mail.moved.mockRejectedValueOnce(new Error("boom"));
    expect((await move(f.users.olga, f.ana.bookingId, at("09:15"))).status).toBe("moved");
    expect(writerLogLines()).toEqual([
      ["business booking mail not sent", { kind: "moved", bookingId: f.ana.bookingId, errorClass: "Error" }],
    ]);
  });

  it("sendMails false sends nothing (cancel, customer cancel and move)", async () => {
    await cancelBusinessBooking(db, f.users.olga, { bookingId: f.bor.bookingId }, NOW, { sendMails: false });
    await cancelBusinessBookingAsCustomer(db, { uid: f.dan.uid, sessionUserId: null }, NOW, {
      sendMails: false,
    });
    await move(f.users.olga, f.ana.bookingId, at("09:15"), {}, { sendMails: false });
    expect(mail.cancelled).not.toHaveBeenCalled();
    expect(mail.moved).not.toHaveBeenCalled();
  });
});
