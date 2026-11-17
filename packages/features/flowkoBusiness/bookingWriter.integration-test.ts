// @vitest-environment node
// Flowko U27: the business booking writer (create, cancel, move) on a real Postgres, through the real client with
// Cal's extensions (excludeLockedUsers, the booking idempotency key) and the real per-worker advisory lock. What
// prismock cannot show is shown here: the lock serialises two desks (Review Focus 1, with a negative control), the
// idempotency key refuses a second booking at exactly the same times (D1) and is cleared by a cancel, a refused
// first booking leaves no mirror behind, mails reach (or never reach) the mail transport (Review Focus 4 and 5;
// vitest's INTEGRATION_TEST_MODE is switched off and nodemailer is mocked, per the global constraints), and a
// moved booking gets its U22 reminder for the new time. Each scenario uses its own worker day of the week of Mon
// 16 Nov 2026 (Ljubljana); `now` is pinned (NOW = Mon 9 Nov 07:00) wherever the code takes it. Google busy is an
// empty stub. Runs only with VITEST_MODE=integration against the throwaway DB.
// Flowko U28: the logged no-show writes the attendee flag and its NO_SHOW action in one transaction (a failed
// action insert leaves the flag unchanged).

import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { IdempotencyKeyService } from "@calcom/lib/idempotencyKey/idempotencyKeyService";
import logger from "@calcom/lib/logger"; // Flowko U27: the spy on the "mail not sent" log line (Review Focus 4)
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { dueCandidatesWhere, dueReminders } from "@lib/flowko/attendeeReminders";
import type { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelBusinessBooking, moveBusinessBooking } from "./bookingChange";
import { getFreeStarts } from "./bookingDay";
import { setBusinessNoShow } from "./bookingNoShow"; // Flowko U28
import {
  type CreateBookingInput,
  createBusinessBooking,
  isIdempotencyKeyConflict,
  isServiceForeignKeyRace, // Flowko U29b
  lockWorkerAdvisory,
  type WriterDeps,
} from "./bookingWriter";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import type { FlowkoBusinessError } from "./errors";
import { stepEventId } from "./googleStepEvents"; // Flowko U30
import { type StepCalendar, syncBookingStepEvents } from "./googleStepSync"; // Flowko U30
import { setMemberLock } from "./lock";
import { setUsualWeek } from "./roster";

const transport = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));
vi.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: (payload: Record<string, unknown>, callback: (error: Error | null, info: unknown) => void) => {
      transport.sent.push(payload);
      callback(null, {});
    },
  }),
}));
// Flowko U29j: every sender of the booking mail module is wrapped (it still runs for real), so a test can tell
// "the mail code was reached and found nothing to send" from "the mail code was never reached".
const mailSpy = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("./bookingMail", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bookingMail")>();
  const wrapped: Record<string, unknown> = { ...original };
  for (const [name, value] of Object.entries(original)) {
    if (name.startsWith("send") && typeof value === "function") {
      wrapped[name] = (...args: unknown[]) => {
        mailSpy.calls.push(name);
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    }
  }
  return wrapped;
});
// The U22 sweep route, called directly: its Next wrappers are cut away, as in its own route test.
vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir: (handler: (req: NextRequest) => Promise<unknown>) => (req: NextRequest) =>
    handler(req),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}));

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-09T06:00:00Z"); // Mon 07:00 in Ljubljana
const MON = "2026-11-16";
const TUE = "2026-11-17";
const WED = "2026-11-18";
const THU = "2026-11-19";
const FRI = "2026-11-20";
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const HOUR_MS = 3_600_000;
const BUSINESS_NAME = `Salon Integracija ${RUN}`;

const noGoogle: NonNullable<WriterDeps["googleBusy"]> = async () => ({ busy: [], unavailable: false });
const quiet: WriterDeps = { googleBusy: noGoogle, sendMails: false };

type Fx = {
  businessId: number;
  olga: number;
  users: { ana: number; bor: number; lea: number };
  members: { ana: number; bor: number; lea: number; mojca: number };
  mojcaUserId: number;
  leaEmail: string;
  services: { mens: number; colouring: number };
};
let fx: Fx;

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

async function realUser(name: string): Promise<{ id: number; email: string }> {
  const username = `${name.toLowerCase()}-${RUN}`;
  return prisma.user.create({
    data: {
      email: `${username}@example.com`,
      username,
      name,
      timeZone: TZ,
      completedOnboarding: true,
      emailVerified: new Date(),
    },
    select: { id: true, email: true },
  });
}

function bookingInput(over: Partial<CreateBookingInput>): CreateBookingInput {
  return {
    workerMemberId: fx.members.ana,
    serviceIds: [fx.services.mens],
    start: at(MON, "09:00"),
    customer: { name: "Marija Novak", phone: "041 123 456" },
    confirmOverride: false,
    ...over,
  };
}

const create = (over: Partial<CreateBookingInput>, deps: WriterDeps = quiet, db: FlowkoDb = prisma) =>
  createBusinessBooking(db, fx.olga, bookingInput(over), NOW, deps);

async function created(promise: ReturnType<typeof create>): Promise<{ bookingId: number; uid: string }> {
  const result = await promise;
  if (result.status !== "created") throw new Error(`expected created, got ${JSON.stringify(result)}`);
  return { bookingId: result.bookingId, uid: result.uid };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "FlowkoBusinessError",
    code,
  } as Partial<FlowkoBusinessError>);
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The worker's ACCEPTED bookings of a business-local day. */
const acceptedOn = (userId: number, date: string) =>
  prisma.booking.findMany({
    where: {
      userId,
      status: BookingStatus.ACCEPTED,
      startTime: { gte: at(date, "00:00"), lt: at(date, "23:59") },
    },
    select: { id: true, startTime: true },
    orderBy: { startTime: "asc" },
  });

beforeAll(async () => {
  const olga = await realUser("Olga");
  const { businessId, ownerMemberId: _owner } = await createBusiness(prisma, {
    ownerUserId: olga.id,
    name: BUSINESS_NAME,
    slug: `salon-int-${RUN}`,
    templateId: "hair-salon",
    address: "Glavna ulica 1, Ljubljana",
  });
  await prisma.flowkoBusiness.update({ where: { id: businessId }, data: { openHolidays: [] } });
  const ana = await realUser("Ana");
  const bor = await realUser("Bor");
  const lea = await realUser("Lea");
  const anaMember = await addLoginMember(prisma, businessId, ana.id, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(prisma, businessId, bor.id, FlowkoBusinessRole.WORKER);
  const leaMember = await addLoginMember(prisma, businessId, lea.id, FlowkoBusinessRole.WORKER);
  const mojca = await createDeskOnlyWorker(prisma, businessId, "Mojca");

  const services = await prisma.flowkoService.findMany({
    where: { businessId },
    select: { id: true, name: true },
  });
  const idOf = (name: string) => {
    const s = services.find((x) => x.name === name);
    if (!s) throw new Error(`fixture: service ${name} missing`);
    return s.id;
  };
  const ids = { mens: idOf("Moško striženje"), colouring: idOf("Barvanje") };
  const both = [anaMember.memberId, leaMember.memberId, mojca.memberId];
  await prisma.flowkoServiceWorker.createMany({
    data: [
      ...both.flatMap((memberId) => [
        { serviceId: ids.mens, memberId },
        { serviceId: ids.colouring, memberId },
      ]),
      { serviceId: ids.mens, memberId: borMember.memberId },
    ],
  });
  const usual = (memberId: number, hours: ShiftEntry[]) =>
    setUsualWeek(prisma, olga.id, { memberId, usualWeek: week(hours), confirmOutsideOpening: false });
  for (const memberId of both) await usual(memberId, [{ from: "07:00", to: "15:00" }]);
  await usual(borMember.memberId, [{ from: "12:00", to: "20:00" }]);

  fx = {
    businessId,
    olga: olga.id,
    users: { ana: ana.id, bor: bor.id, lea: lea.id },
    members: {
      ana: anaMember.memberId,
      bor: borMember.memberId,
      lea: leaMember.memberId,
      mojca: mojca.memberId,
    },
    mojcaUserId: mojca.userId,
    leaEmail: lea.email,
    services: ids,
  };
});

beforeEach(() => {
  transport.sent.length = 0;
  globalThis.testEmails = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Review Focus 1: two desks, one worker (the real advisory lock)", () => {
  it("B waits on A's lock; after A commits, B sees A's booking: needs_confirm overlaps_booking", async () => {
    const gate = deferred();
    const aHolds = deferred();
    const bAsks = deferred();
    const events: string[] = [];
    let calls = 0;
    const lockWorker: NonNullable<WriterDeps["lockWorker"]> = async (tx, userId) => {
      const me = calls++ === 0 ? "A" : "B";
      if (me === "B") bAsks.resolve();
      await lockWorkerAdvisory(tx, userId);
      events.push(`${me}:locked`);
      if (me === "A") {
        aHolds.resolve();
        await gate.promise;
      }
    };
    const deps = { ...quiet, lockWorker };

    // Ana's first booking: the mirror is created under the lock too.
    const a = create({ start: at(MON, "09:00") }, deps);
    await aHolds.promise;
    const b = create({ start: at(MON, "09:15") }, deps);
    let bSettled = false;
    b.then(
      () => {
        bSettled = true;
      },
      () => {
        bSettled = true;
      }
    );
    await bAsks.promise;
    await sleep(300);
    expect(bSettled).toBe(false);
    expect(events).toEqual(["A:locked"]);

    gate.resolve();
    expect((await a).status).toBe("created");
    expect(await b).toEqual({
      status: "needs_confirm",
      problems: [
        {
          kind: "overlaps_booking",
          step: 0,
          with: { start: at(MON, "09:00").getTime(), end: at(MON, "09:30").getTime() },
        },
      ],
      googleUnavailable: false, // Flowko U28: R7
    });
    expect(events).toEqual(["A:locked", "B:locked"]);
    expect(await acceptedOn(fx.users.ana, MON)).toHaveLength(1);
    expect(await prisma.flowkoWorkerMirror.count({ where: { memberId: fx.members.ana } })).toBe(1);
  });

  it("negative control: without the lock both desks pass the fit and two overlapping bookings are written", async () => {
    // Both transactions are held at booking.create until both arrived: both fits ran before either commit.
    const arrived = { count: 0 };
    const bothAtWrite = deferred();
    const holdAtCreate = async () => {
      arrived.count += 1;
      if (arrived.count === 2) bothAtWrite.resolve();
      await Promise.race([
        bothAtWrite.promise,
        sleep(10_000).then(() => {
          throw new Error("the other desk never reached its write");
        }),
      ]);
    };
    const bind = <T extends object>(target: T, prop: string | symbol) => {
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    };
    const wrapTx = (tx: Prisma.TransactionClient) =>
      new Proxy(tx, {
        get(target, prop) {
          if (prop !== "booking") return bind(target, prop);
          return new Proxy(target.booking, {
            get(delegate, method) {
              if (method !== "create") return bind(delegate, method);
              return async (args: Parameters<typeof delegate.create>[0]) => {
                await holdAtCreate();
                return delegate.create(args);
              };
            },
          });
        },
      });
    const heldDb = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return bind(target, prop);
        return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction((tx) => fn(wrapTx(tx)));
      },
    }) as unknown as FlowkoDb;
    const noLock = { ...quiet, lockWorker: async () => undefined };

    const [a, b] = await Promise.all([
      create({ start: at(FRI, "09:00") }, noLock, heldDb),
      create({ start: at(FRI, "09:15") }, noLock, heldDb),
    ]);
    expect(a.status).toBe("created");
    expect(b.status).toBe("created");
    expect(await acceptedOn(fx.users.ana, FRI)).toHaveLength(2);
  });
});

describe("Postgres proofs of the writer (Task 5 carry-overs)", () => {
  it("a needs_confirm on a worker's first booking leaves no mirror, event type or schedule behind", async () => {
    const mirrorRows = () =>
      Promise.all([
        prisma.flowkoWorkerMirror.count({ where: { memberId: fx.members.bor } }),
        prisma.eventType.count({ where: { userId: fx.users.bor } }),
        prisma.schedule.count({ where: { userId: fx.users.bor } }),
      ]);
    expect(await mirrorRows()).toEqual([0, 0, 0]);
    // 08:00 is outside Bor's shift (12–20).
    const refused = await create({ workerMemberId: fx.members.bor, start: at(MON, "08:00") });
    expect(refused.status).toBe("needs_confirm");
    expect(await mirrorRows()).toEqual([0, 0, 0]);
    // Positive control: the same worker inside his shift gets the mirror.
    await created(create({ workerMemberId: fx.members.bor, start: at(MON, "13:00") }));
    expect(await mirrorRows()).toEqual([1, 1, 1]);
  });

  it("D1: the idempotency key is set through the transaction client; same times → duplicate_time; cancel frees them", async () => {
    const x = await created(create({ start: at(THU, "12:00") }));
    const xRow = await prisma.booking.findUniqueOrThrow({ where: { id: x.bookingId } });
    expect(xRow.idempotencyKey).toBe(
      IdempotencyKeyService.generate({
        startTime: at(THU, "12:00"),
        endTime: at(THU, "12:30"),
        userId: fx.users.ana,
      })
    );

    const before = await prisma.booking.count({ where: { userId: fx.users.ana } });
    await expectCode(create({ start: at(THU, "12:00"), confirmOverride: true }), "duplicate_time");
    expect(await prisma.booking.count({ where: { userId: fx.users.ana } })).toBe(before);

    // The shape PrismaPg gives a violation of Booking.idempotencyKey, and the detector's answer to it.
    const y = await created(create({ start: at(THU, "13:00") }));
    const raw = await prisma.booking
      .update({ where: { id: y.bookingId }, data: { idempotencyKey: xRow.idempotencyKey } })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(raw).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((raw as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    expect((raw as Prisma.PrismaClientKnownRequestError).meta).toMatchObject({
      modelName: "Booking",
      driverAdapterError: { cause: { constraint: { fields: ['"idempotencyKey"'] } } },
    });
    expect(isIdempotencyKeyConflict(raw)).toBe(true);

    // A move onto X's exact times → duplicate_time; Y unchanged (rolled back).
    await expectCode(
      moveBusinessBooking(
        prisma,
        fx.olga,
        { bookingId: y.bookingId, start: at(THU, "12:00"), confirmOverride: true },
        NOW,
        quiet
      ),
      "duplicate_time"
    );
    const yRow = await prisma.booking.findUniqueOrThrow({
      where: { id: y.bookingId },
      include: { flowkoBookingSteps: true, flowkoBookingActions: true },
    });
    expect(yRow.startTime).toEqual(at(THU, "13:00"));
    expect(yRow.iCalSequence).toBe(0);
    expect(yRow.flowkoBookingSteps.map((s) => s.startTime)).toEqual([at(THU, "13:00")]);
    expect(yRow.flowkoBookingActions.map((a) => a.action)).toEqual(["CREATED"]);

    // Cancelling X clears its key: the same create now succeeds.
    await cancelBusinessBooking(prisma, fx.olga, { bookingId: x.bookingId }, NOW, { sendMails: false });
    const xCancelled = await prisma.booking.findUniqueOrThrow({ where: { id: x.bookingId } });
    expect(xCancelled).toMatchObject({
      status: BookingStatus.CANCELLED,
      idempotencyKey: null,
      iCalSequence: 1,
    });
    const again = await created(create({ start: at(THU, "12:00") }));
    expect(again.bookingId).not.toBe(x.bookingId);
  });
});

// Flowko U29b (D1 e): a service removed after the desk read it and before the step insert.
describe("U29b: a service removed during the write → service_not_assigned (real foreign key)", () => {
  it("create: the service is deleted through another connection after the lock → service_not_assigned, nothing written", async () => {
    const race = await prisma.flowkoService.create({
      data: { businessId: fx.businessId, name: `Wettlauf ${RUN}`, steps: [{ kind: "busy", minutes: 30 }] },
    });
    await prisma.flowkoServiceWorker.create({ data: { serviceId: race.id, memberId: fx.members.ana } });
    const start = at(FRI, "13:00");
    const deleteAfterLock: NonNullable<WriterDeps["lockWorker"]> = async (tx, userId) => {
      await lockWorkerAdvisory(tx, userId);
      // The outer client is a separate connection: this commits while the writer's transaction is open.
      await prisma.flowkoService.delete({ where: { id: race.id } });
    };
    await expectCode(
      create({ serviceIds: [race.id], start }, { ...quiet, lockWorker: deleteAfterLock }),
      "service_not_assigned"
    );
    expect(await prisma.flowkoService.count({ where: { id: race.id } })).toBe(0);
    const key = IdempotencyKeyService.generate({
      startTime: start,
      endTime: at(FRI, "13:30"),
      userId: fx.users.ana,
    });
    expect(await prisma.booking.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(
      await acceptedOn(fx.users.ana, FRI).then((rows) => rows.filter((r) => +r.startTime === +start))
    ).toEqual([]);
  });

  it("pins the real error: a step insert naming a missing service is a P2003 the matcher accepts; another FK is not", async () => {
    const booking = await created(create({ start: at(FRI, "14:00") }));
    const raw = await prisma.flowkoBookingStep
      .create({
        data: {
          bookingId: booking.bookingId,
          index: 99,
          kind: "busy",
          startTime: at(FRI, "14:00"),
          endTime: at(FRI, "14:30"),
          serviceId: 2_000_000_000,
          serviceName: "x",
        },
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(raw).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((raw as Prisma.PrismaClientKnownRequestError).code).toBe("P2003");
    // The shape PrismaPg gives (read from this run): the constraint name sits in driverAdapterError.cause.
    expect((raw as Prisma.PrismaClientKnownRequestError).meta).toMatchObject({
      modelName: "FlowkoBookingStep",
      driverAdapterError: {
        cause: {
          kind: "ForeignKeyConstraintViolation",
          constraint: { index: "FlowkoBookingStep_serviceId_fkey" },
        },
      },
    });
    expect(isServiceForeignKeyRace(raw)).toBe(true);

    const otherFk = await prisma.flowkoBookingStep
      .create({
        data: {
          bookingId: 2_000_000_000,
          index: 99,
          kind: "busy",
          startTime: at(FRI, "14:00"),
          endTime: at(FRI, "14:30"),
          serviceName: "x",
        },
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect((otherFk as Prisma.PrismaClientKnownRequestError).code).toBe("P2003");
    expect(isServiceForeignKeyRace(otherFk)).toBe(false);
  });
});

describe("Review Focus 2 on Postgres: the processing gap, then the move", () => {
  it("cut in the gap without override; the cut cancelled; Barvanje moved to 09:15; free starts offer 09:45, not 09:30", async () => {
    const colour = await created(create({ serviceIds: [fx.services.colouring], start: at(TUE, "09:00") }));
    const cut = await created(create({ start: at(TUE, "09:30") }));
    // 09:45–10:15 runs into Barvanje's busy step from 10:10 (and into the cut itself).
    const late = await create({ start: at(TUE, "09:45") });
    expect(late.status).toBe("needs_confirm");
    if (late.status !== "needs_confirm") return;
    expect(late.problems).toContainEqual({
      kind: "overlaps_booking",
      step: 0,
      with: { start: at(TUE, "10:10").getTime(), end: at(TUE, "10:40").getTime() },
    });
    await cancelBusinessBooking(prisma, fx.olga, { bookingId: cut.bookingId }, NOW, { sendMails: false });

    const moved = await moveBusinessBooking(
      prisma,
      fx.olga,
      { bookingId: colour.bookingId, start: at(TUE, "09:15"), confirmOverride: false },
      NOW,
      quiet
    );
    expect(moved).toEqual({ status: "moved", bookingId: colour.bookingId, uid: colour.uid });
    const steps = await prisma.flowkoBookingStep.findMany({
      where: { bookingId: colour.bookingId },
      orderBy: { index: "asc" },
    });
    expect(steps.map((s) => [s.kind, s.startTime, s.endTime])).toEqual([
      ["busy", at(TUE, "09:15"), at(TUE, "09:45")],
      ["processing", at(TUE, "09:45"), at(TUE, "10:25")],
      ["busy", at(TUE, "10:25"), at(TUE, "10:55")],
    ]);

    const view = await getFreeStarts(prisma, fx.olga, { date: TUE, serviceIds: [fx.services.mens] }, NOW, {
      googleBusy: noGoogle,
    });
    const ana = view.workers.find((w) => w.memberId === fx.members.ana);
    expect(ana?.starts).toContain(at(TUE, "09:45").toISOString());
    expect(ana?.starts).not.toContain(at(TUE, "09:30").toISOString());
  });
});

describe("Review Focus 4: phone-only customer at a desk-only worker (the mail transport)", () => {
  it("Mojca, phone-only customer → 0 transport calls; e-mail customer → 1 call, to the customer, no flowko.invalid", async () => {
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
    const mails = { googleBusy: noGoogle };
    // Every sub-logger is a tslog Logger whose `error` lives on the prototype (the same spy as bookingChange.test.ts),
    // so this catches the writer's catch (sendMailAfterCommit) and the mail module's own catch (sendLogged) alike:
    // a `fromBooking` that threw for the phone-only booking would be swallowed there and log this line, while
    // 0 transport calls alone would still hold.
    const logError = vi
      .spyOn(Object.getPrototypeOf(logger) as { error: (...args: unknown[]) => unknown }, "error")
      .mockImplementation(() => undefined);
    const mailNotSent = () =>
      logError.mock.calls.filter((call) => call[0] === "business booking mail not sent");

    try {
      await created(
        create(
          { workerMemberId: fx.members.mojca, serviceIds: [fx.services.colouring], start: at(MON, "09:00") },
          mails
        )
      );
      expect(transport.sent).toHaveLength(0);
      // The mail code ran and found nothing to send; it did not fail.
      expect(mailNotSent()).toEqual([]);

      const customer = `eva-${RUN}@example.com`;
      await created(
        create(
          {
            workerMemberId: fx.members.mojca,
            start: at(MON, "12:00"),
            customer: { name: "Eva Kos", email: customer },
          },
          mails
        )
      );
      // Positive control: the customer's confirmation reaches the transport.
      expect(transport.sent).toHaveLength(1);
      expect(mailNotSent()).toEqual([]);
      const sent = transport.sent[0] as {
        to: Array<{ address: string }>;
        text: string;
        html: string;
        icalEvent?: { content?: string };
      };
      expect(sent.to.map((t) => t.address)).toEqual([customer]);
      expect(sent.icalEvent?.content).toContain("BEGIN:VCALENDAR");
      for (const part of [sent.text, sent.html, sent.icalEvent?.content ?? ""]) {
        expect(part).not.toContain("flowko.invalid");
      }
      expect(JSON.stringify(sent)).not.toContain("flowko.invalid");
    } finally {
      logError.mockRestore();
    }
  });
});

describe("Review Focus 5: a Cal-locked worker", () => {
  it("the owner cancels Lea's booking after she is locked: customer mail through the transport, none to Lea; a move is worker_locked", async () => {
    const customer = `nina-${RUN}@example.com`;
    const first = await created(
      create({
        workerMemberId: fx.members.lea,
        start: at(MON, "10:00"),
        customer: { name: "Nina", email: customer },
      })
    );
    const second = await created(create({ workerMemberId: fx.members.lea, start: at(MON, "11:00") }));
    await setMemberLock(prisma, fx.members.lea, true, NOW);
    expect(await prisma.user.count({ where: { id: fx.users.lea, locked: true } })).toBe(1);
    // Cal's extension hides her from a top-level read: the writer must never make one.
    expect(await prisma.user.findUnique({ where: { id: fx.users.lea } })).toBeNull();

    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
    expect(await cancelBusinessBooking(prisma, fx.olga, { bookingId: first.bookingId }, NOW)).toEqual({
      status: "cancelled",
    });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: first.bookingId } })).status).toBe(
      BookingStatus.CANCELLED
    );
    const recipients = transport.sent.flatMap((m) =>
      (m.to as Array<{ address: string }>).map((t) => t.address)
    );
    expect(recipients).toEqual([customer]);
    expect(recipients).not.toContain(fx.leaEmail);

    await expectCode(
      moveBusinessBooking(
        prisma,
        fx.olga,
        { bookingId: second.bookingId, start: at(MON, "11:15"), confirmOverride: true },
        NOW,
        quiet
      ),
      "worker_locked"
    );
  });
});

describe("U22: a business booking's reminder, before and after a move", () => {
  it("selected 24 h ahead; the move drops its claim; the sweep's reminder for the new time names the business", async () => {
    const customer = `petra-${RUN}@example.com`;
    const s1 = at(WED, "09:00");
    const s2 = at(WED, "09:15");
    const booking = await created(create({ start: s1, customer: { name: "Petra Zupan", email: customer } }));
    // Made 25 h ahead, then set back 2 h (the 60-minute gap of U22): the database stamped real time.
    const madeAt = new Date(s1.getTime() - 27 * HOUR_MS);
    await prisma.$executeRaw`UPDATE "Booking" SET "createdAt" = ${madeAt}, "updatedAt" = ${madeAt} WHERE id = ${booking.bookingId}`;
    // Flowko U30: date-independent (join time before the backdated booking): a booking made before its organizer
    // joined stays private (access.ts mayOnBooking), so the worker's join time goes back before madeAt too.
    const joinedAt = (
      await prisma.flowkoBusinessMember.findUniqueOrThrow({
        where: { id: fx.members.ana },
        select: { createdAt: true },
      })
    ).createdAt;
    await prisma.flowkoBusinessMember.update({
      where: { id: fx.members.ana },
      data: { createdAt: new Date(Math.min(joinedAt.getTime(), madeAt.getTime() - HOUR_MS)) },
    });

    const dueAt = (start: Date) => new Date(start.getTime() - 24 * HOUR_MS + 60_000);
    const selected = (now: Date) =>
      prisma.booking.findMany({
        where: { AND: [dueCandidatesWhere(now), { id: booking.bookingId }] },
        select: {
          id: true,
          startTime: true,
          createdAt: true,
          updatedAt: true,
          eventType: { select: { metadata: true } },
        },
      });
    const rows = await selected(dueAt(s1));
    expect(rows).toHaveLength(1);
    expect(dueReminders({ ...rows[0], eventTypeMetadata: rows[0].eventType?.metadata }, dueAt(s1))).toEqual([
      1440,
    ]);

    // The sweep claims it; a claimed booking is no longer selected.
    await prisma.flowkoAttendeeReminder.create({
      data: { bookingId: booking.bookingId, offsetMinutes: 1440 },
    });
    expect(await selected(dueAt(s1))).toHaveLength(0);

    await moveBusinessBooking(
      prisma,
      fx.olga,
      { bookingId: booking.bookingId, start: s2, confirmOverride: false },
      NOW,
      quiet
    );
    expect(await prisma.flowkoAttendeeReminder.count({ where: { bookingId: booking.bookingId } })).toBe(0);
    // The move ran at real time; pinned again so the 60-minute gap holds on any run date.
    await prisma.$executeRaw`UPDATE "Booking" SET "updatedAt" = ${madeAt} WHERE id = ${booking.bookingId}`;
    expect(await selected(dueAt(s2))).toHaveLength(1);

    // The real sweep route at the new reminder moment (INTEGRATION_TEST_MODE collects its mail).
    vi.stubEnv("FLOWKO_REMINDER_CRON_SECRET", "u27-integration-test-cron-secret-0123456789");
    const { POST } = await import("app/api/cron/attendeeReminder/route");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(dueAt(s2));
    const request = {
      headers: new Headers({ authorization: "Bearer u27-integration-test-cron-secret-0123456789" }),
    } as unknown as NextRequest;
    const response = (await (POST as unknown as (req: NextRequest) => Promise<unknown>)(request)) as {
      body: { due: number };
    };
    vi.useRealTimers();
    expect(response.body.due).toBe(1);
    const mails = (globalThis.testEmails ?? []) as unknown as Array<{ to: string; subject: string }>;
    const reminders = mails.filter((m) => m.to.includes(customer));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].subject).toBe(`Opomnik: ${BUSINESS_NAME} – 09:15 - 09:45, sreda, 18. november 2026`);
  });
});

// Flowko U28: D4 on Postgres.
describe("U28: the no-show and its action are one transaction", () => {
  it("a failing NO_SHOW action insert rolls the attendee flag back; without the failure both are written", async () => {
    const booking = await created(
      create({ workerMemberId: fx.members.bor, start: at(THU, "15:00"), confirmOverride: true })
    );
    const afterStart = at(THU, "15:10");
    const flags = async () =>
      (
        await prisma.attendee.findMany({ where: { bookingId: booking.bookingId }, select: { noShow: true } })
      ).map((a) => a.noShow);
    const noShowActions = () =>
      prisma.flowkoBookingAction.count({ where: { bookingId: booking.bookingId, action: "NO_SHOW" } });
    expect(await flags()).toEqual([false]);

    const bind = <T extends object>(target: T, prop: string | symbol) => {
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    };
    const seen: string[] = [];
    const failingTx = (tx: Prisma.TransactionClient) =>
      new Proxy(tx, {
        get(target, prop) {
          if (prop === "attendee") {
            return new Proxy(target.attendee, {
              get(delegate, method) {
                if (method !== "updateMany") return bind(delegate, method);
                return async (args: Parameters<typeof delegate.updateMany>[0]) => {
                  const result = await delegate.updateMany(args);
                  seen.push(`attendee.updateMany:${result.count}`);
                  return result;
                };
              },
            });
          }
          if (prop === "flowkoBookingAction") {
            return new Proxy(target.flowkoBookingAction, {
              get(delegate, method) {
                if (method !== "create") return bind(delegate, method);
                return async () => {
                  seen.push("flowkoBookingAction.create");
                  throw new Error("forced action insert failure");
                };
              },
            });
          }
          return bind(target, prop);
        },
      });
    const failingDb = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return bind(target, prop);
        return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction((tx) => fn(failingTx(tx)));
      },
    }) as unknown as FlowkoDb;

    await expect(
      setBusinessNoShow(failingDb, fx.olga, { bookingId: booking.bookingId, noShow: true }, afterStart)
    ).rejects.toThrow("forced action insert failure");
    // The flag was written inside the transaction, then rolled back with it.
    expect(seen).toEqual(["attendee.updateMany:1", "flowkoBookingAction.create"]);
    expect(await flags()).toEqual([false]);
    expect(await noShowActions()).toBe(0);

    expect(
      await setBusinessNoShow(prisma, fx.olga, { bookingId: booking.bookingId, noShow: true }, afterStart)
    ).toEqual({ status: "updated", noShow: true });
    expect(await flags()).toEqual([true]);
    expect(await noShowActions()).toBe(1);
  });
});

// Flowko U29j: a desk-only worker has a placeholder address nobody can read and a phone-only customer has none, so
// moving, handing over and marking a no-show must send no mail at all, and the mail code must not fail while
// finding that out. Every zero has a positive control: the same action for a customer with an e-mail address
// does reach the transport (and never a placeholder address), or, for the no-show (which mails nobody by design),
// the wrapped mail senders prove the mail code was not reached while the same spy sees a cancel reach it.
describe("U29j: no mail for a desk-only worker and a phone-only customer", () => {
  const mails: WriterDeps = { googleBusy: noGoogle }; // no `sendMails: false`: the mail code really runs
  let nena: number;
  let logError: { mockRestore: () => void; mock: { calls: unknown[][] } };

  beforeAll(async () => {
    // A second desk-only worker for the hand-over (never a login worker).
    const worker = await createDeskOnlyWorker(prisma, fx.businessId, "Nena");
    nena = worker.memberId;
    await prisma.flowkoServiceWorker.create({ data: { serviceId: fx.services.mens, memberId: nena } });
    await setUsualWeek(prisma, fx.olga, {
      memberId: nena,
      usualWeek: week([{ from: "07:00", to: "15:00" }]),
      confirmOutsideOpening: false,
    });
  });

  beforeEach(() => {
    mailSpy.calls.length = 0;
    vi.stubEnv("INTEGRATION_TEST_MODE", "false");
    // The same spy as Review Focus 4: it catches the writer's catch and the mail module's own catch alike.
    logError = vi
      .spyOn(Object.getPrototypeOf(logger) as { error: (...args: unknown[]) => unknown }, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logError.mockRestore();
  });

  const mailNotSent = () =>
    logError.mock.calls.filter((call) => call[0] === "business booking mail not sent");
  const phoneOnly = (name: string) => ({ name, phone: "041 234 567" });
  const withEmail = (name: string) => ({
    name,
    email: `${name.toLowerCase().replace(/\s/g, "-")}-${RUN}@example.com`,
  });
  const recipients = () =>
    transport.sent.flatMap((m) => (m.to as Array<{ address: string }>).map((t) => t.address));
  /** Positive control: the transport got mail, only for the customer, and nothing carries a placeholder address. */
  const expectMailToCustomerOnly = (address: string | undefined) => {
    expect(transport.sent.length).toBeGreaterThanOrEqual(1);
    expect(new Set(recipients())).toEqual(new Set([address]));
    expect(JSON.stringify(transport.sent)).not.toContain("flowko.invalid");
    expect(mailNotSent()).toEqual([]);
  };

  it("move: a phone-only booking of Mojca sends nothing; an e-mail customer's move reaches the transport", async () => {
    const phone = await created(
      create({
        workerMemberId: fx.members.mojca,
        start: at(WED, "09:00"),
        customer: phoneOnly("Tina Horvat"),
      })
    );
    expect(transport.sent).toHaveLength(0); // the create above ran without mails

    const moved = await moveBusinessBooking(
      prisma,
      fx.olga,
      { bookingId: phone.bookingId, start: at(WED, "10:00"), confirmOverride: false },
      NOW,
      mails
    );
    expect(moved.status).toBe("moved");
    expect(mailSpy.calls).toEqual(["sendBusinessBookingMoved"]); // the mail code ran ...
    expect(transport.sent).toHaveLength(0); // ... and found nobody to mail
    expect(mailNotSent()).toEqual([]);

    // Positive control: the same move for a customer with an e-mail address.
    const customer = withEmail("Zala Kranjc");
    const control = await created(
      create({ workerMemberId: fx.members.mojca, start: at(WED, "12:00"), customer })
    );
    mailSpy.calls.length = 0;
    const movedControl = await moveBusinessBooking(
      prisma,
      fx.olga,
      { bookingId: control.bookingId, start: at(WED, "13:00"), confirmOverride: false },
      NOW,
      mails
    );
    expect(movedControl.status).toBe("moved");
    expect(mailSpy.calls).toEqual(["sendBusinessBookingMoved"]);
    expectMailToCustomerOnly(customer.email);
  });

  it("hand-over (create at Nena, then the marked cancel at Mojca): a phone-only customer gets nothing; an e-mail customer's does", async () => {
    // Exactly the server calls of the desk's „Prestavi k drugemu delavcu“ (BookingSheet.save): the create through
    // bookings.create (default deps), then bookings.cancel with `handoverToMemberId` (default deps).
    const handOver = async (
      from: number,
      to: number,
      start: Date,
      customer: CreateBookingInput["customer"]
    ) => {
      const old = await created(create({ workerMemberId: from, start, customer }));
      transport.sent.length = 0;
      mailSpy.calls.length = 0;
      const next = await created(create({ workerMemberId: to, start, customer }, mails));
      const cancelled = await cancelBusinessBooking(
        prisma,
        fx.olga,
        { bookingId: old.bookingId, reason: "Prestavljeno k delavcu Nena", handoverToMemberId: to },
        NOW
      );
      expect(cancelled).toEqual({ status: "cancelled" });
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: old.bookingId } })).status).toBe(
        BookingStatus.CANCELLED
      );
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: next.bookingId } })).status).toBe(
        BookingStatus.ACCEPTED
      );
      const action = await prisma.flowkoBookingAction.findFirstOrThrow({
        where: { bookingId: old.bookingId, action: "CANCELLED" },
        select: { details: true },
      });
      expect(action.details).toMatchObject({ handoverToMemberId: to });
    };

    await handOver(fx.members.mojca, nena, at(WED, "11:00"), phoneOnly("Maja Kovač"));
    expect(mailSpy.calls).toEqual(["sendBusinessBookingCreated", "sendBusinessBookingCancelled"]);
    expect(transport.sent).toHaveLength(0);
    expect(mailNotSent()).toEqual([]);

    // Positive control: the same hand-over for a customer with an e-mail address.
    const customer = withEmail("Ula Breznik");
    await handOver(fx.members.mojca, nena, at(WED, "14:00"), customer);
    expect(mailSpy.calls).toEqual(["sendBusinessBookingCreated", "sendBusinessBookingCancelled"]);
    expectMailToCustomerOnly(customer.email);
  });

  it("no-show: marking a phone-only booking of Mojca sends nothing and never reaches the mail code", async () => {
    const phone = await created(
      create({ workerMemberId: fx.members.mojca, start: at(WED, "08:00"), customer: phoneOnly("Eva Zupan") })
    );
    const customer = withEmail("Nik Rozman");
    const control = await created(
      create({ workerMemberId: fx.members.mojca, start: at(WED, "08:30"), customer })
    );
    transport.sent.length = 0;
    mailSpy.calls.length = 0;

    for (const { bookingId, start } of [
      { bookingId: phone.bookingId, start: at(WED, "08:00") },
      { bookingId: control.bookingId, start: at(WED, "08:30") },
    ]) {
      const result = await setBusinessNoShow(
        prisma,
        fx.olga,
        { bookingId, noShow: true },
        new Date(start.getTime() + 10 * 60_000)
      );
      expect(result).toEqual({ status: "updated", noShow: true });
      const flags = await prisma.attendee.findMany({ where: { bookingId }, select: { noShow: true } });
      expect(flags.map((a) => a.noShow)).toEqual([true]);
    }
    // The no-show mails nobody by design, so a transport count of 0 alone proves little, even for the e-mail
    // customer: the wrapped senders show that the mail module is not reached at all.
    expect(mailSpy.calls).toEqual([]);
    expect(transport.sent).toHaveLength(0);
    expect(mailNotSent()).toEqual([]);

    // The spy is live: a cancel of the e-mail customer's booking reaches the mail module and the transport.
    await cancelBusinessBooking(prisma, fx.olga, { bookingId: control.bookingId }, NOW);
    expect(mailSpy.calls).toEqual(["sendBusinessBookingCancelled"]);
    expectMailToCustomerOnly(customer.email);
  });
});

// Flowko U30: create, move and cancel through the real writers on Postgres, with Google replaced by a fake calendar
// that behaves like Google (update 404 for an unknown id, insert 409 for a known one, delete 404 for an unknown one).
describe("U30: Google step events through create, move and cancel", () => {
  it("one id set across the three syncs, the last one deletes every step id; the booking rows are as before U30", async () => {
    const known = new Map<string, Record<string, unknown>>();
    const deleted: string[] = [];
    // Flowko U30: the shape of a real gaxios 6 HTTP error (numeric status and response.status, no code).
    const gone = (status: number) =>
      Object.assign(new Error(`Request failed with status code ${status}`), { status, response: { status } });
    const calendar: StepCalendar = {
      calendarId: "primary",
      events: {
        update: async (args: { eventId: string; requestBody: Record<string, unknown> }) => {
          if (!known.has(args.eventId)) throw gone(404);
          known.set(args.eventId, args.requestBody);
        },
        insert: async (args: { requestBody: Record<string, unknown> }) => {
          const id = String(args.requestBody.id);
          if (known.has(id)) throw gone(409);
          known.set(id, args.requestBody);
        },
        delete: async (args: { eventId: string }) => {
          deleted.push(args.eventId);
          if (!known.delete(args.eventId)) throw gone(410);
        },
      } as unknown as StepCalendar["events"],
    };
    const syncGoogle = (bookingId: number) =>
      syncBookingStepEvents(prisma, bookingId, NOW, { target: async () => calendar });
    const deps: WriterDeps = { ...quiet, syncGoogle };

    const { bookingId, uid } = await created(
      create({ serviceIds: [fx.services.colouring], start: at(THU, "08:00") }, deps)
    );
    const busyIds = [0, 2].map((index) => stepEventId(uid, index));
    expect(Array.from(known.keys()).sort()).toEqual([...busyIds].sort());
    const startOf = (id: string) => (known.get(id)?.start as { dateTime: string }).dateTime;
    expect(busyIds.map(startOf)).toEqual([at(THU, "08:00").toISOString(), at(THU, "09:10").toISOString()]);
    for (const body of Array.from(known.values())) {
      expect(body).not.toHaveProperty("attendees");
      expect(JSON.stringify(body)).not.toContain(uid);
    }

    const moved = await moveBusinessBooking(
      prisma,
      fx.olga,
      { bookingId, start: at(THU, "08:15"), confirmOverride: false },
      NOW,
      deps
    );
    expect(moved.status).toBe("moved");
    expect(Array.from(known.keys()).sort()).toEqual([...busyIds].sort());
    expect(busyIds.map(startOf)).toEqual([at(THU, "08:15").toISOString(), at(THU, "09:25").toISOString()]);

    await cancelBusinessBooking(prisma, fx.olga, { bookingId }, NOW, deps);
    expect(known.size).toBe(0);
    expect(deleted.sort()).toEqual([0, 1, 2].map((index) => stepEventId(uid, index)).sort());

    // The booking rows: what U27 wrote, and nothing of Google's.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        status: true,
        flowkoBookingSteps: { select: { index: true, kind: true }, orderBy: { index: "asc" } },
        flowkoBookingActions: { select: { action: true }, orderBy: { id: "asc" } },
      },
    });
    expect(booking?.status).toBe(BookingStatus.CANCELLED);
    expect(booking?.flowkoBookingSteps.map((step) => [step.index, step.kind])).toEqual([
      [0, "busy"],
      [1, "processing"],
      [2, "busy"],
    ]);
    expect(booking?.flowkoBookingActions.map((row) => row.action)).toEqual([
      "CREATED",
      "RESCHEDULED",
      "CANCELLED",
    ]);
    expect(await prisma.bookingReference.count({ where: { bookingId } })).toBe(0);
  });
});
