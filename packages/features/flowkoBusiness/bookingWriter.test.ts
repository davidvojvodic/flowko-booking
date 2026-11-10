// Flowko U27: the booking writer (create) on prismock. Business A (owner Olga, login workers Ana, Bor and Dan
// (LOCKED), desk-only worker Cene, staff Rok with a login) and B (owner Zala, worker Bea); hair-salon template
// services; usual weeks Mon–Fri 07–15 (Bor 12–20). Prismock ignores unique keys, extensions, $executeRaw and
// rollbacks: the worker lock is an injected vi.fn here, and the real lock, the idempotency key and the rollback
// are proven on Postgres (Task 6). The business mail is mocked except in the one test that runs the real sender.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import * as emailManager from "@calcom/emails/email-manager";
import { getBookerEventTitle } from "@calcom/emails/lib/getBookerEventTitle";
import getICalUID from "@calcom/emails/lib/getICalUID";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bookingMail from "./bookingMail";
import {
  type CreateBookingInput,
  createBusinessBooking,
  resolveActor,
  type WriterDeps,
} from "./bookingWriter";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import type { FlowkoBusinessError } from "./errors";
import { setUsualWeek } from "./roster";

vi.mock("@calcom/emails/email-manager", async (importOriginal) => {
  const real = await importOriginal<typeof import("@calcom/emails/email-manager")>();
  return {
    ...real,
    sendScheduledEmailsAndSMS: vi.fn(real.sendScheduledEmailsAndSMS),
    sendRescheduledEmailsAndSMS: vi.fn(real.sendRescheduledEmailsAndSMS),
    sendCancelledEmailsAndSMS: vi.fn(real.sendCancelledEmailsAndSMS),
  };
});
vi.mock("./bookingMail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bookingMail")>()),
  sendBusinessBookingCreated: vi.fn(async () => undefined),
}));
// CalendarEventBuilder.fromBooking asks the feature flags (as the Task 4 mail test does).
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));
vi.mock("@calcom/features/flags/operations/check-if-user-has-feature.controller", () => ({
  checkIfUserHasFeatureController: vi.fn(async () => false),
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
  members: {
    olga: number;
    ana: number;
    bor: number;
    cene: number;
    dan: number;
    rok: number;
    zala: number;
    bea: number;
  };
  cene: { userId: number };
  services: Record<"mens" | "colouring", number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `bw-a-${seq}`,
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
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `bw-b-${seq}`,
    templateId: "hair-salon",
  });
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

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
  // Dan is locked after his set-up (a locked worker keeps his services and roster).
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED },
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
      bea: beaMember.memberId,
    },
    cene: { userId: cene.userId },
    services: ids,
  };
}

let f: Fixture;
let lockWorker: ReturnType<typeof vi.fn<NonNullable<WriterDeps["lockWorker"]>>>;
let googleBusy: ReturnType<typeof vi.fn<NonNullable<WriterDeps["googleBusy"]>>>;
const mailMock = vi.mocked(bookingMail.sendBusinessBookingCreated);
/** The unmocked sender (its own imports, email-manager included, stay mocked as above). */
const realCreatedSender = async () =>
  (await vi.importActual<typeof import("./bookingMail")>("./bookingMail")).sendBusinessBookingCreated;

beforeEach(async () => {
  f = await setUp();
  lockWorker = vi.fn(async () => undefined);
  googleBusy = vi.fn(async () => ({ busy: [], unavailable: false }));
  mailMock.mockClear();
  vi.mocked(emailManager.sendScheduledEmailsAndSMS).mockClear();
  globalThis.testEmails = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PHONE_ONLY = { name: "Marija Novak", phone: "041 123 456" };

function input(over: Partial<CreateBookingInput> = {}): CreateBookingInput {
  return {
    workerMemberId: f.members.ana,
    serviceIds: [f.services.colouring],
    start: new Date("2026-11-16T08:00:00Z"),
    customer: PHONE_ONLY,
    confirmOverride: false,
    ...over,
  };
}

const create = (actorUserId: number, over: Partial<CreateBookingInput> = {}, deps: WriterDeps = {}) =>
  createBusinessBooking(db, actorUserId, input(over), NOW, { lockWorker, googleBusy, ...deps });

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "FlowkoBusinessError",
    code,
  } as Partial<FlowkoBusinessError>);
}

async function created(promise: ReturnType<typeof create>): Promise<{ bookingId: number; uid: string }> {
  const result = await promise;
  if (result.status !== "created") throw new Error(`expected created, got ${JSON.stringify(result)}`);
  return result;
}

const stepsOf = (bookingId: number) =>
  prismock.flowkoBookingStep.findMany({ where: { bookingId }, orderBy: { index: "asc" } });
const actionsOf = (bookingId: number) => prismock.flowkoBookingAction.findMany({ where: { bookingId } });
const counts = async () => ({
  bookings: await prismock.booking.count(),
  steps: await prismock.flowkoBookingStep.count(),
  actions: await prismock.flowkoBookingAction.count(),
});

describe("createBusinessBooking: the booking (W1)", () => {
  it("Olga books Ana, Barvanje 09:00, phone-only customer: booking, step copy and action", async () => {
    const createSpy = vi.spyOn(prismock.booking, "create");
    const { bookingId, uid } = await created(create(f.users.olga));

    const mirror = await prismock.flowkoWorkerMirror.findUnique({ where: { memberId: f.members.ana } });
    const ana = await prismock.user.findUnique({ where: { id: f.users.ana } });
    const booking = await prismock.booking.findUnique({
      where: { id: bookingId },
      include: { attendees: true },
    });
    expect(booking).toMatchObject({
      uid,
      userId: f.users.ana,
      eventTypeId: mirror?.eventTypeId,
      status: BookingStatus.ACCEPTED,
      title: "Barvanje med Ana in Marija Novak",
      userPrimaryEmail: ana?.email,
      startTime: at("09:00"),
      endTime: at("10:40"),
      iCalUID: getICalUID({ uid }),
      iCalSequence: 0,
      oneTimePassword: null,
      location: "Glavna ulica 1, Ljubljana",
      metadata: {},
      responses: { name: "Marija Novak", attendeePhoneNumber: "+38641123456" },
    });
    expect(booking?.uid).toMatch(/^[1-9A-HJ-NP-Za-km-z]{20,24}$/);
    expect(booking?.attendees).toHaveLength(1);
    expect(booking?.attendees[0]).toMatchObject({
      name: "Marija Novak",
      email: "38641123456@sms.cal.com",
      timeZone: TZ,
      locale: "sl",
      phoneNumber: "+38641123456",
    });

    const steps = await stepsOf(bookingId);
    expect(steps.map((s) => [s.index, s.kind, s.startTime, s.endTime, s.serviceId, s.serviceName])).toEqual([
      [0, "busy", at("09:00"), at("09:30"), f.services.colouring, "Barvanje"],
      [1, "processing", at("09:30"), at("10:10"), f.services.colouring, "Barvanje"],
      [2, "busy", at("10:10"), at("10:40"), f.services.colouring, "Barvanje"],
    ]);

    const actions = await actionsOf(bookingId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: "CREATED",
      businessId: f.a,
      actorMemberId: f.members.olga,
      actorName: "Olga",
      userId: f.users.olga,
      details: null,
    });

    expect(lockWorker).toHaveBeenCalledTimes(1);
    expect(lockWorker.mock.calls[0][1]).toBe(f.users.ana);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(lockWorker.mock.invocationCallOrder[0]).toBeLessThan(createSpy.mock.invocationCallOrder[0]);
    // W1: the idempotency extension reads only user.connect.id; startTime/endTime are Dates.
    const data = createSpy.mock.calls[0][0].data as Prisma.BookingCreateInput & { userId?: unknown };
    expect(data.user).toEqual({ connect: { id: f.users.ana } });
    expect(data.userId).toBeUndefined();
    expect(data.startTime).toBeInstanceOf(Date);
    expect(data.endTime).toBeInstanceOf(Date);
  });

  it("an e-mail customer is the attendee address and the responses' e-mail", async () => {
    const { bookingId } = await created(
      create(f.users.olga, { customer: { name: "Eva", email: "Eva@Example.com" } })
    );
    const booking = await prismock.booking.findUnique({
      where: { id: bookingId },
      include: { attendees: true },
    });
    expect(booking?.responses).toEqual({ name: "Eva", email: "eva@example.com" });
    expect(booking?.attendees[0]).toMatchObject({ email: "eva@example.com", phoneNumber: null });
  });

  it("Barvanje + Moško striženje: 4 steps, joined title, the last step names the cut", async () => {
    const { bookingId } = await created(
      create(f.users.olga, { serviceIds: [f.services.colouring, f.services.mens] })
    );
    const booking = await prismock.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.title).toBe("Barvanje + Moško striženje med Ana in Marija Novak");
    expect(booking?.endTime).toEqual(at("11:10"));
    const steps = await stepsOf(bookingId);
    expect(steps).toHaveLength(4);
    expect(steps[3]).toMatchObject({
      index: 3,
      kind: "busy",
      startTime: at("10:40"),
      endTime: at("11:10"),
      serviceId: f.services.mens,
      serviceName: "Moško striženje",
    });
  });

  it("the mirror is created once and reused", async () => {
    await created(create(f.users.olga));
    await created(create(f.users.olga, { start: at("12:00"), serviceIds: [f.services.mens] }));
    expect(await prismock.flowkoWorkerMirror.count({ where: { memberId: f.members.ana } })).toBe(1);
  });
});

describe("createBusinessBooking: fit and override (W3)", () => {
  it("a men's cut in Barvanje's processing gap (09:30) is created without override", async () => {
    await created(create(f.users.olga));
    const { bookingId } = await created(
      create(f.users.olga, { serviceIds: [f.services.mens], start: at("09:30") })
    );
    expect((await actionsOf(bookingId))[0].details).toBeNull();
  });

  it("09:45 runs into the busy step from 10:10: needs_confirm, nothing written; override writes it", async () => {
    await created(create(f.users.olga));
    const before = await counts();
    lockWorker.mockClear();

    const refused = await create(f.users.olga, { serviceIds: [f.services.mens], start: at("09:45") });
    expect(refused).toEqual({
      status: "needs_confirm",
      problems: [
        {
          kind: "overlaps_booking",
          step: 0,
          with: { start: at("10:10").getTime(), end: at("10:40").getTime() },
        },
      ],
      googleUnavailable: false, // Flowko U28: R7
    });
    expect(await counts()).toEqual(before);
    expect(mailMock).toHaveBeenCalledTimes(1); // only the first booking's mail

    const { bookingId } = await created(
      create(f.users.olga, { serviceIds: [f.services.mens], start: at("09:45"), confirmOverride: true })
    );
    expect((await actionsOf(bookingId))[0].details).toEqual({ overrides: ["overlaps_booking"] });
    expect(await prismock.booking.count()).toBe(before.bookings + 1);
  });

  it("outside Ana's shift (16:00) → needs_confirm outside_shift", async () => {
    const result = await create(f.users.olga, { start: at("16:00") });
    expect(result.status).toBe("needs_confirm");
    if (result.status !== "needs_confirm") return;
    expect(result.problems.map((p) => p.kind)).toContain("outside_shift");
    expect(await prismock.booking.count()).toBe(0);
  });

  it("override lists each problem kind once", async () => {
    const { bookingId } = await created(create(f.users.olga, { start: at("14:30"), confirmOverride: true }));
    // 14:30 Barvanje: busy 14:30–15:00 inside the shift, 15:40–16:10 outside it.
    expect((await actionsOf(bookingId))[0].details).toEqual({ overrides: ["outside_shift"] });
  });

  it("Google busy is fetched for the business-local day before the transaction and counts as external", async () => {
    googleBusy.mockImplementation(async () => ({
      busy: [{ start: at("09:00").getTime(), end: at("09:15").getTime() }],
      unavailable: false,
    }));
    const result = await create(f.users.olga);
    expect(result).toMatchObject({
      status: "needs_confirm",
      problems: [{ kind: "overlaps_external", step: 0 }],
    });
    expect(googleBusy).toHaveBeenCalledWith(f.users.ana, {
      start: new Date("2026-11-15T23:00:00Z").getTime(),
      end: new Date("2026-11-16T23:00:00Z").getTime(),
    });
    expect(googleBusy.mock.invocationCallOrder[0]).toBeLessThan(lockWorker.mock.invocationCallOrder[0]);
  });

  it("a booking crossing local midnight is bad_booking; an invalid start too", async () => {
    await expectCode(
      create(f.users.olga, { start: new Date("2026-11-16T22:30:00Z"), confirmOverride: true }),
      "bad_booking"
    );
    await expectCode(create(f.users.olga, { start: new Date("nope") }), "bad_booking");
    expect(await prismock.booking.count()).toBe(0);
  });
});

describe("createBusinessBooking: rights (Ruling 1) and actor (W6)", () => {
  it("Ana books herself", async () => {
    const { bookingId } = await created(create(f.users.ana));
    expect((await actionsOf(bookingId))[0]).toMatchObject({ actorMemberId: f.members.ana, actorName: "Ana" });
  });

  it("Ana books Bor → forbidden", async () => {
    await expectCode(
      create(f.users.ana, {
        workerMemberId: f.members.bor,
        serviceIds: [f.services.mens],
        start: at("13:00"),
      }),
      "forbidden"
    );
  });

  it("Rok (staff) books Cene (desk-only) with actor Rok", async () => {
    const { bookingId } = await created(create(f.users.rok, { workerMemberId: f.members.cene }));
    const booking = await prismock.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.userId).toBe(f.cene.userId);
    expect((await actionsOf(bookingId))[0]).toMatchObject({
      actorMemberId: f.members.rok,
      actorName: "Rok",
      userId: f.users.rok,
    });
  });

  it("actorMemberId = Cene from Olga's session: actor Cene, user Olga", async () => {
    const { bookingId } = await created(create(f.users.olga, { actorMemberId: f.members.cene }));
    expect((await actionsOf(bookingId))[0]).toMatchObject({
      actorMemberId: f.members.cene,
      actorName: "Cene",
      userId: f.users.olga,
    });
  });

  it("actorMemberId of another business, an unknown id or a LOCKED member → forbidden", async () => {
    await expectCode(create(f.users.olga, { actorMemberId: f.members.zala }), "forbidden");
    await expectCode(create(f.users.olga, { actorMemberId: 999_999 }), "forbidden");
    await expectCode(create(f.users.olga, { actorMemberId: f.members.dan }), "forbidden");
    expect(await prismock.booking.count()).toBe(0);
  });

  it("booking Dan (LOCKED) → worker_locked; for a WORKER actor the role rule comes first", async () => {
    await expectCode(create(f.users.olga, { workerMemberId: f.members.dan }), "worker_locked");
    await expectCode(create(f.users.ana, { workerMemberId: f.members.dan }), "forbidden");
  });

  it("Bea (business B) and an unknown worker → forbidden; a staff target → forbidden", async () => {
    await expectCode(create(f.users.olga, { workerMemberId: f.members.bea }), "forbidden");
    await expectCode(create(f.users.olga, { workerMemberId: 999_999 }), "forbidden");
    await expectCode(create(f.users.olga, { workerMemberId: f.members.rok }), "forbidden");
  });

  it("a user in no business → forbidden; Zala cannot book A's Ana", async () => {
    const stranger = await makeUser("Stranger");
    await expectCode(create(stranger), "forbidden");
    await expectCode(create(f.users.zala), "forbidden");
  });

  it("a bad customer and a service Bor does not perform are refused before the transaction", async () => {
    await expectCode(create(f.users.olga, { customer: { name: "X" } }), "bad_customer");
    await expectCode(
      create(f.users.olga, { workerMemberId: f.members.bor, start: at("13:00") }),
      "service_not_assigned"
    );
    expect(lockWorker).not.toHaveBeenCalled();
  });

  it("resolveActor: default is the actor's own member", async () => {
    const access = { businessId: f.a, memberId: f.members.rok, userId: f.users.rok, role: "STAFF" as const };
    expect(await resolveActor(db, access)).toEqual({ memberId: f.members.rok, name: "Rok" });
    expect(await resolveActor(db, access, null)).toEqual({ memberId: f.members.rok, name: "Rok" });
    const recepcija = await prismock.flowkoBusinessMember.findFirst({ where: { displayName: "Recepcija" } });
    expect(await resolveActor(db, access, recepcija?.id)).toEqual({
      memberId: recepcija?.id,
      name: "Recepcija",
    });
  });
});

describe("createBusinessBooking: mails after commit", () => {
  it("sendBusinessBookingCreated once with the new id, after the transaction committed", async () => {
    const events: string[] = [];
    const loggingDb = new Proxy(prismock, {
      get(target, prop, receiver) {
        if (prop === "$transaction") {
          return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
            const result = await prismock.$transaction(fn);
            events.push("commit");
            return result;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as FlowkoDb;
    mailMock.mockImplementation(async () => {
      events.push("mail");
    });

    const result = await createBusinessBooking(loggingDb, f.users.olga, input(), NOW, {
      lockWorker,
      googleBusy,
    });
    if (result.status !== "created") throw new Error("expected created");
    expect(mailMock).toHaveBeenCalledTimes(1);
    expect(mailMock).toHaveBeenCalledWith(result.bookingId);
    expect(events).toEqual(["commit", "mail"]);
  });

  it("sendMails false sends nothing", async () => {
    await created(create(f.users.olga, {}, { sendMails: false }));
    expect(mailMock).not.toHaveBeenCalled();
  });

  it("the real sender: titleSource keeps the stored title and the attendee's Subject equals Booking.title", async () => {
    mailMock.mockImplementationOnce(await realCreatedSender());
    const scheduled = vi.mocked(emailManager.sendScheduledEmailsAndSMS);

    const { bookingId } = await created(
      create(f.users.olga, { customer: { name: "Marija Novak", email: "marija@example.com" } })
    );
    const booking = await prismock.booking.findUnique({ where: { id: bookingId } });
    const mirror = await prismock.flowkoWorkerMirror.findUnique({
      where: { memberId: f.members.ana },
      include: { eventType: true },
    });

    expect(scheduled).toHaveBeenCalledTimes(1);
    const [evt, eventNameObject, hostDisabled, attendeeDisabled, metadata, titleSource] =
      scheduled.mock.calls[0];
    expect(eventNameObject).toBeUndefined();
    expect(hostDisabled).toBe(false);
    expect(attendeeDisabled).toBe(false);
    expect(metadata).toMatchObject({ flowkoMirror: true });
    expect(titleSource).toEqual({ eventType: "Salon A", eventName: "{Event type title}" });
    expect(mirror?.eventType.title).toBe("Salon A");
    expect(evt.type).toBe("Salon A");
    expect(evt.title).toBe(booking?.title);
    const attendee = evt.attendees[0];
    expect(getBookerEventTitle(evt, attendee, titleSource)).toBe("Barvanje med Ana in Marija Novak");

    // INTEGRATION_TEST_MODE collects every payload before the transport.
    const mails = (globalThis.testEmails ?? []) as unknown as Array<{ to: string; subject: string }>;
    const toCustomer = mails.filter((m) => m.to.includes("marija@example.com"));
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0].subject).toBe(booking?.title);
  });

  it("a failing mail is logged and never undoes the booking", async () => {
    mailMock.mockImplementationOnce(await realCreatedSender());
    vi.mocked(emailManager.sendScheduledEmailsAndSMS).mockRejectedValueOnce(new Error("smtp down"));
    const { bookingId } = await created(create(f.users.olga));
    expect(await prismock.booking.findUnique({ where: { id: bookingId } })).not.toBeNull();
  });
});

describe("createBusinessBooking: duplicate time (D1)", () => {
  const p2002 = (meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta,
    });

  it("P2002 on the idempotency key (meta.target) → duplicate_time", async () => {
    vi.spyOn(prismock.booking, "create").mockRejectedValueOnce(p2002({ target: ["idempotencyKey"] }));
    await expectCode(create(f.users.olga), "duplicate_time");
    expect(mailMock).not.toHaveBeenCalled();
  });

  it("P2002 from the driver adapter naming the column or the index → duplicate_time", async () => {
    vi.spyOn(prismock.booking, "create")
      .mockRejectedValueOnce(
        p2002({
          modelName: "Booking",
          driverAdapterError: {
            cause: { kind: "UniqueConstraintViolation", constraint: { fields: ['"idempotencyKey"'] } },
          },
        })
      )
      .mockRejectedValueOnce(
        p2002({
          modelName: "Booking",
          driverAdapterError: {
            cause: { kind: "UniqueConstraintViolation", constraint: { index: "Booking_idempotencyKey_key" } },
          },
        })
      );
    await expectCode(create(f.users.olga), "duplicate_time");
    await expectCode(create(f.users.olga), "duplicate_time");
  });

  it("any other P2002 is rethrown", async () => {
    const other = p2002({ target: ["uid"] });
    vi.spyOn(prismock.booking, "create").mockRejectedValueOnce(other);
    await expect(create(f.users.olga)).rejects.toBe(other);
  });
});

// Flowko U29b: a service removed between the desk's read and the step insert (D1 e) → service_not_assigned.
describe("createBusinessBooking: service removed during the write (U29b D1 e)", () => {
  const p2003 = (meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
      code: "P2003",
      clientVersion: "test",
      meta,
    });

  it("P2003 on the step's serviceId foreign key (meta.field_name) → service_not_assigned; no mail", async () => {
    vi.spyOn(prismock.flowkoBookingStep, "createMany").mockRejectedValueOnce(
      p2003({ modelName: "FlowkoBookingStep", field_name: "FlowkoBookingStep_serviceId_fkey (index)" })
    );
    await expectCode(create(f.users.olga), "service_not_assigned");
    expect(mailMock).not.toHaveBeenCalled();
  });

  it("P2003 from the driver adapter naming the constraint → service_not_assigned; no mail", async () => {
    vi.spyOn(prismock.flowkoBookingStep, "createMany").mockRejectedValueOnce(
      p2003({
        modelName: "FlowkoBookingStep",
        driverAdapterError: {
          // The shape pinned on Postgres (bookingWriter.integration-test.ts).
          name: "DriverAdapterError",
          cause: {
            originalCode: "23503",
            kind: "ForeignKeyConstraintViolation",
            constraint: { index: "FlowkoBookingStep_serviceId_fkey" },
          },
        },
      })
    );
    await expectCode(create(f.users.olga), "service_not_assigned");
    expect(mailMock).not.toHaveBeenCalled();
  });

  it("any other P2003 is rethrown", async () => {
    const other = p2003({
      modelName: "FlowkoBookingStep",
      field_name: "FlowkoBookingStep_bookingId_fkey (index)",
    });
    vi.spyOn(prismock.flowkoBookingStep, "createMany").mockRejectedValueOnce(other);
    await expect(create(f.users.olga)).rejects.toBe(other);
  });

  it("a plain error naming the constraint is not mistaken for the race", async () => {
    const plain = new Error("FlowkoBookingStep_serviceId_fkey");
    vi.spyOn(prismock.flowkoBookingStep, "createMany").mockRejectedValueOnce(plain);
    await expect(create(f.users.olga)).rejects.toBe(plain);
  });
});

// Flowko U28: no booking in the past (R6), the Google-unavailable flag (R7) and the WORKER actor rule (R9).
/** Mon 16 Nov 08:07 in Ljubljana: the 08:00 slot is the current one. */
const DESK_NOW = new Date("2026-11-16T07:07:00Z");
const createAt = (now: Date, actorUserId: number, over: Partial<CreateBookingInput> = {}) =>
  createBusinessBooking(db, actorUserId, input(over), now, { lockWorker, googleBusy });
/** What googleBusyFor answers on a failed or timed-out fetch: the whole day busy and unavailable. */
const googleDown: NonNullable<WriterDeps["googleBusy"]> = async (_userId, day) => ({
  busy: [day],
  unavailable: true,
});

describe("createBusinessBooking: no booking in the past (R6, U28)", () => {
  it("07:45 when it is 08:07 → in_past, even with confirmOverride; nothing written, no Google call, no lock", async () => {
    await expectCode(createAt(DESK_NOW, f.users.olga, { start: at("07:45") }), "in_past");
    await expectCode(
      createAt(DESK_NOW, f.users.olga, { start: at("07:45"), confirmOverride: true }),
      "in_past"
    );
    expect(await counts()).toEqual({ bookings: 0, steps: 0, actions: 0 });
    expect(googleBusy).not.toHaveBeenCalled();
    expect(lockWorker).not.toHaveBeenCalled();
  });

  it("08:00, the current slot, is still bookable (walk-ins)", async () => {
    const { bookingId } = await created(createAt(DESK_NOW, f.users.olga, { start: at("08:00") }));
    expect((await prismock.booking.findUnique({ where: { id: bookingId } }))?.startTime).toEqual(at("08:00"));
  });

  it("a start on an earlier day is in_past too", async () => {
    await expectCode(
      createAt(DESK_NOW, f.users.olga, { start: new Date("2026-11-13T09:00:00Z"), confirmOverride: true }),
      "in_past"
    );
  });
});

describe("createBusinessBooking: Google unavailable (R7, U28)", () => {
  it("a failing Google → needs_confirm overlaps_external with googleUnavailable true; nothing written", async () => {
    googleBusy.mockImplementation(googleDown);
    const result = await create(f.users.olga);
    expect(result).toMatchObject({ status: "needs_confirm", googleUnavailable: true });
    if (result.status !== "needs_confirm") return;
    expect(result.problems.map((p) => p.kind)).toContain("overlaps_external");
    expect(await counts()).toEqual({ bookings: 0, steps: 0, actions: 0 });
  });

  it("with the override it is created (uid included), the override logged", async () => {
    googleBusy.mockImplementation(googleDown);
    const result = await create(f.users.olga, { confirmOverride: true });
    expect(result).toEqual({ status: "created", bookingId: expect.any(Number), uid: expect.any(String) });
    if (result.status !== "created") return;
    expect((await actionsOf(result.bookingId))[0].details).toEqual({ overrides: ["overlaps_external"] });
  });

  it("without Google trouble a problem answers googleUnavailable false", async () => {
    const result = await create(f.users.olga, { start: at("16:00") });
    expect(result).toMatchObject({ status: "needs_confirm", googleUnavailable: false });
  });
});

describe("resolveActor: a WORKER may not label an action with another member (R9, U28)", () => {
  it("Ana (WORKER) books herself with actorMemberId = Olga → forbidden, nothing written", async () => {
    await expectCode(create(f.users.ana, { actorMemberId: f.members.olga }), "forbidden");
    await expectCode(create(f.users.ana, { actorMemberId: f.members.cene }), "forbidden");
    expect(await counts()).toEqual({ bookings: 0, steps: 0, actions: 0 });
    expect(lockWorker).not.toHaveBeenCalled();
  });

  it("Ana with her own id or none → ok", async () => {
    const own = await created(create(f.users.ana, { actorMemberId: f.members.ana }));
    expect((await actionsOf(own.bookingId))[0]).toMatchObject({ actorMemberId: f.members.ana });
    const none = await created(create(f.users.ana, { start: at("12:00"), actorMemberId: null }));
    expect((await actionsOf(none.bookingId))[0]).toMatchObject({ actorMemberId: f.members.ana });
  });

  it("Olga (OWNER) and Rok (STAFF) naming Cene → ok (U27 W6 unchanged)", async () => {
    const byOlga = await created(create(f.users.olga, { actorMemberId: f.members.cene }));
    const byRok = await created(
      create(f.users.rok, { workerMemberId: f.members.cene, actorMemberId: f.members.cene })
    );
    for (const { bookingId } of [byOlga, byRok]) {
      expect((await actionsOf(bookingId))[0]).toMatchObject({
        actorMemberId: f.members.cene,
        actorName: "Cene",
      });
    }
  });

  it("resolveActor directly: a WORKER access naming another member → forbidden", async () => {
    const access = { businessId: f.a, memberId: f.members.ana, userId: f.users.ana, role: "WORKER" as const };
    await expectCode(resolveActor(db, access, f.members.olga), "forbidden");
    expect(await resolveActor(db, access, f.members.ana)).toEqual({ memberId: f.members.ana, name: "Ana" });
    expect(await resolveActor(db, access)).toEqual({ memberId: f.members.ana, name: "Ana" });
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

  it("Olga (OWNER) naming Cene (ACTIVE), Dan (LOCKED), Zala (foreign) or an unknown id → Olga is recorded, no error", async () => {
    const cases: [number, CreateBookingInput["workerMemberId"], string][] = [
      [f.members.cene, f.members.ana, "09:00"],
      [f.members.dan, f.members.ana, "11:00"],
      [f.members.zala, f.members.ana, "13:00"],
      [999_999, f.members.cene, "09:00"],
    ];
    for (const [actorMemberId, workerMemberId, time] of cases) {
      const { bookingId } = await created(
        create(f.users.olga, { actorMemberId, workerMemberId, start: at(time) })
      );
      expect(await actionsOf(bookingId)).toEqual([
        expect.objectContaining({ actorMemberId: f.members.olga, actorName: "Olga", userId: f.users.olga }),
      ]);
    }
    expect(await prismock.booking.count()).toBe(4);
  });

  it("Rok (STAFF) naming Recepcija → Rok is recorded; resolveActor ignores every other id for him", async () => {
    const recepcija = await prismock.flowkoBusinessMember.findFirst({ where: { displayName: "Recepcija" } });
    expect(recepcija?.id).toBeDefined();
    const { bookingId } = await created(
      create(f.users.rok, {
        workerMemberId: f.members.cene,
        start: at("11:00"),
        actorMemberId: recepcija?.id,
      })
    );
    expect((await actionsOf(bookingId))[0]).toMatchObject({
      actorMemberId: f.members.rok,
      actorName: "Rok",
      userId: f.users.rok,
    });
    const access = { businessId: f.a, memberId: f.members.rok, userId: f.users.rok, role: "STAFF" as const };
    for (const id of [f.members.cene, f.members.dan, f.members.zala, 999_999]) {
      expect(await resolveActor(db, access, id)).toEqual({ memberId: f.members.rok, name: "Rok" });
    }
  });

  it("Ana (WORKER) naming Olga or Cene → forbidden, nothing written", async () => {
    await expectCode(create(f.users.ana, { actorMemberId: f.members.olga }), "forbidden");
    await expectCode(create(f.users.ana, { actorMemberId: f.members.cene }), "forbidden");
    expect(await counts()).toEqual({ bookings: 0, steps: 0, actions: 0 });
    expect(lockWorker).not.toHaveBeenCalled();
  });

  it("no business read when actorMemberId is absent or the own member; one read when it names another", async () => {
    const findUnique = vi.spyOn(prismock.flowkoBusiness, "findUnique");
    const findFirst = vi.spyOn(prismock.flowkoBusiness, "findFirst");
    const access = {
      businessId: f.a,
      memberId: f.members.olga,
      userId: f.users.olga,
      role: "OWNER" as const,
    };
    expect(await resolveActor(db, access)).toEqual({ memberId: f.members.olga, name: "Olga" });
    expect(await resolveActor(db, access, null)).toEqual({ memberId: f.members.olga, name: "Olga" });
    expect(await resolveActor(db, access, f.members.olga)).toEqual({
      memberId: f.members.olga,
      name: "Olga",
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();

    await created(create(f.users.olga, { actorMemberId: f.members.olga }));
    expect(sharedDeviceReads(findUnique) + sharedDeviceReads(findFirst)).toBe(0);

    expect(await resolveActor(db, access, f.members.cene)).toEqual({
      memberId: f.members.olga,
      name: "Olga",
    });
    expect(sharedDeviceReads(findUnique) + sharedDeviceReads(findFirst)).toBe(1);
  });

  it("switched back on: Olga naming Cene records Cene again (U28b)", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { sharedDevice: true } });
    const { bookingId } = await created(create(f.users.olga, { actorMemberId: f.members.cene }));
    expect((await actionsOf(bookingId))[0]).toMatchObject({
      actorMemberId: f.members.cene,
      actorName: "Cene",
    });
  });
});
