// @vitest-environment node
// Flowko U29a: the owner's service catalogue on a real database (prismock ignores FK actions, unique indexes and
// rollbacks). Proves Review Focus 5 (Dan, LOCKED, keeps „Barvanje“ when the owner saves it with Ana only; Bor and
// Olga are removed; a save naming Dan is bad_member and changes nothing), Review Focus 6 (Ana's stepped
// „Barvanje“ booking written by the U27 writer keeps its steps, times and service name through a shorter
// processing step, a rename and the removal; the desk still draws it and, once the service is gone, offers no
// service ids, so re-enter shows „services gone“), and S8's name rule on Postgres: a case-insensitive clash from
// the read, and a parallel save with the exact name (P2002 on FlowkoService_businessId_name_key) → both
// service_name_taken. Runs only with VITEST_MODE=integration against the throwaway DB.

import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, createBusiness } from "./business";
import { getDeskDay } from "./desk";
import { FlowkoBusinessError } from "./errors";
import { setMemberLock } from "./lock";
import { setUsualWeek } from "./roster";
import {
  listServicesForOwner,
  removeService,
  reorderServices,
  type SaveServiceInput,
  saveService,
} from "./services";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const TUE = "2026-11-17";
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const noGoogle: NonNullable<WriterDeps["googleBusy"]> = async () => ({ busy: [], unavailable: false });
const quiet: WriterDeps = { googleBusy: noGoogle, sendMails: false };
const BARVANJE_STEPS = [
  { kind: "busy" as const, minutes: 30 },
  { kind: "processing" as const, minutes: 40 },
  { kind: "busy" as const, minutes: 30 },
];

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

type Fx = {
  businessId: number;
  olga: number;
  members: { olga: number; ana: number; bor: number; dan: number };
  barvanje: number;
};
let fx: Fx;

async function realUser(name: string): Promise<number> {
  const username = `${name.toLowerCase()}-${RUN}`;
  const user = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name, timeZone: TZ, completedOnboarding: true },
    select: { id: true },
  });
  return user.id;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (e) {
    if (e instanceof FlowkoBusinessError) return e.code;
    throw e;
  }
}

async function assigned(serviceId: number): Promise<number[]> {
  const rows = await prisma.flowkoServiceWorker.findMany({
    where: { serviceId },
    select: { memberId: true },
  });
  return rows.map((r) => r.memberId).sort((x, y) => x - y);
}

const sorted = (ids: number[]) => Array.from(ids).sort((x, y) => x - y);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The booking and its step copy, everything a service edit must leave alone. */
async function bookingCopy(bookingId: number) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      startTime: true,
      endTime: true,
      status: true,
      title: true,
      flowkoBookingSteps: {
        select: {
          index: true,
          kind: true,
          startTime: true,
          endTime: true,
          serviceName: true,
          serviceId: true,
        },
        orderBy: { index: "asc" },
      },
    },
  });
  if (!booking) throw new Error("fixture: booking missing");
  return booking;
}

async function deskBooking(bookingId: number) {
  const view = await getDeskDay(prisma, fx.olga, { date: TUE }, NOW, { googleBusy: noGoogle });
  return view.days[0].bookings.find((b) => b.bookingId === bookingId);
}

beforeAll(async () => {
  const olga = await realUser("Olga");
  const { businessId, ownerMemberId, serviceIds } = await createBusiness(prisma, {
    ownerUserId: olga,
    name: `Salon Storitve ${RUN}`,
    slug: `salon-stor-${RUN}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
    address: "Glavna ulica 1, Ljubljana",
  });
  await prisma.flowkoBusiness.update({ where: { id: businessId }, data: { openHolidays: [] } });
  const ana = await addLoginMember(prisma, businessId, await realUser("Ana"), FlowkoBusinessRole.WORKER);
  const bor = await addLoginMember(prisma, businessId, await realUser("Bor"), FlowkoBusinessRole.WORKER);
  const dan = await addLoginMember(prisma, businessId, await realUser("Dan"), FlowkoBusinessRole.WORKER);
  const barvanje = serviceIds[3];
  const stored = await prisma.flowkoService.findUnique({ where: { id: barvanje }, select: { name: true } });
  expect(stored?.name).toBe("Barvanje");
  // Barvanje: Olga (template), Ana, Bor, Dan; then Dan is locked (the lock keeps his assignment).
  await prisma.flowkoServiceWorker.createMany({
    data: [ana.memberId, bor.memberId, dan.memberId].map((memberId) => ({ serviceId: barvanje, memberId })),
  });
  await setUsualWeek(prisma, olga, {
    memberId: ana.memberId,
    usualWeek: week([{ from: "08:00", to: "16:00" }]),
    confirmOutsideOpening: false,
  });
  await setMemberLock(prisma, dan.memberId, true, NOW);
  fx = {
    businessId,
    olga,
    members: { olga: ownerMemberId, ana: ana.memberId, bor: bor.memberId, dan: dan.memberId },
    barvanje,
  };
});

const barvanjeInput = (over: Partial<SaveServiceInput> = {}): SaveServiceInput => ({
  id: fx.barvanje,
  name: "Barvanje",
  category: "Barvanje",
  steps: BARVANJE_STEPS,
  workerMemberIds: [fx.members.ana],
  priceCents: null, // Flowko U29e: E8 — a required key
  ...over,
});

describe("U29a services on a real database", () => {
  it("Review Focus 5: the LOCKED Dan keeps Barvanje, the unticked go, a save naming Dan changes nothing", async () => {
    expect(await assigned(fx.barvanje)).toEqual(
      sorted([fx.members.olga, fx.members.ana, fx.members.bor, fx.members.dan])
    );
    expect(await saveService(prisma, fx.olga, barvanjeInput())).toEqual({ serviceId: fx.barvanje });
    expect(await assigned(fx.barvanje)).toEqual(sorted([fx.members.ana, fx.members.dan]));

    expect(
      await codeOf(
        saveService(
          prisma,
          fx.olga,
          barvanjeInput({ name: "Barvanje nova", workerMemberIds: [fx.members.ana, fx.members.dan] })
        )
      )
    ).toBe("bad_member");
    const row = await prisma.flowkoService.findUnique({ where: { id: fx.barvanje }, select: { name: true } });
    expect(row?.name).toBe("Barvanje");
    expect(await assigned(fx.barvanje)).toEqual(sorted([fx.members.ana, fx.members.dan]));

    const view = await listServicesForOwner(prisma, fx.olga, NOW);
    const workers = view.services.find((s) => s.id === fx.barvanje)?.workers ?? [];
    expect(workers.filter((w) => w.assigned).map((w) => [w.memberId, w.status])).toEqual([
      [fx.members.ana, "ACTIVE"],
      [fx.members.dan, "LOCKED"],
    ]);
  });

  it("Review Focus 6: a shorter step, a rename and the removal never change Ana's booking", async () => {
    const input: CreateBookingInput = {
      workerMemberId: fx.members.ana,
      serviceIds: [fx.barvanje],
      start: at(TUE, "09:00"),
      customer: { name: "Marija Novak", phone: "041 123 456", email: `marija-${RUN}@example.com` },
      confirmOverride: false,
    };
    const result = await createBusinessBooking(prisma, fx.olga, input, NOW, quiet);
    if (result.status !== "created") throw new Error(`expected created, got ${JSON.stringify(result)}`);
    const bookingId = result.bookingId;
    const original = await bookingCopy(bookingId);
    expect(original.flowkoBookingSteps.map((s) => [s.kind, s.serviceName, s.serviceId])).toEqual([
      ["busy", "Barvanje", fx.barvanje],
      ["processing", "Barvanje", fx.barvanje],
      ["busy", "Barvanje", fx.barvanje],
    ]);
    expect(original.endTime.getTime() - original.startTime.getTime()).toBe(100 * 60_000);
    const futureOf = async () =>
      (await listServicesForOwner(prisma, fx.olga, NOW)).services.find((s) => s.id === fx.barvanje)
        ?.futureBookings;
    expect(await futureOf()).toBe(1);

    // A shorter processing step.
    const shorter = [
      { kind: "busy" as const, minutes: 30 },
      { kind: "processing" as const, minutes: 20 },
      { kind: "busy" as const, minutes: 30 },
    ];
    await saveService(prisma, fx.olga, barvanjeInput({ steps: shorter }));
    expect(await bookingCopy(bookingId)).toEqual(original);
    // A rename.
    await saveService(prisma, fx.olga, barvanjeInput({ name: "Barvanje las", steps: shorter }));
    expect(await bookingCopy(bookingId)).toEqual(original);
    const drawn = await deskBooking(bookingId);
    expect(drawn?.serviceNames).toEqual(["Barvanje"]);
    expect(drawn?.serviceIds).toEqual([fx.barvanje]);
    expect(drawn?.steps?.map((s) => [s.kind, s.start, s.end, s.serviceName])).toEqual(
      original.flowkoBookingSteps.map((s) => [
        s.kind,
        s.startTime.toISOString(),
        s.endTime.toISOString(),
        "Barvanje",
      ])
    );
    expect(await futureOf()).toBe(1);

    // The removal: the service and who does it go; the booking keeps its copy without the service id.
    await removeService(prisma, fx.olga, fx.barvanje);
    expect(await prisma.flowkoService.findUnique({ where: { id: fx.barvanje } })).toBeNull();
    expect(await assigned(fx.barvanje)).toEqual([]);
    expect(await bookingCopy(bookingId)).toEqual({
      ...original,
      flowkoBookingSteps: original.flowkoBookingSteps.map((s) => ({ ...s, serviceId: null })),
    });
    const after = await deskBooking(bookingId);
    expect(after?.serviceNames).toEqual(["Barvanje"]);
    expect(after?.steps).toEqual(drawn?.steps);
    expect(after?.start).toBe(drawn?.start);
    expect(after?.end).toBe(drawn?.end);
    // No service ids → the desk's re-enter starts with empty services (flowko_desk_reenter_services_gone).
    expect(after?.serviceIds).toBeNull();
  });

  it("S8: a name in another case clashes on the read; the exact name from a parallel save is P2002 → taken", async () => {
    const fresh = (name: string): SaveServiceInput => ({
      name,
      category: null,
      steps: [{ kind: "busy", minutes: 30 }],
      workerMemberIds: [fx.members.ana],
      priceCents: null, // Flowko U29e: E8
    });
    expect(await codeOf(saveService(prisma, fx.olga, fresh("MOŠKO STRIŽENJE")))).toBe("service_name_taken");

    // A parallel save holds an uncommitted "Masaža" row: the second save's read cannot see it, its insert waits
    // on the unique index, and fails with P2002 once the first commits.
    const inserted = deferred();
    const release = deferred();
    const first = prisma.$transaction(
      async (tx) => {
        await tx.flowkoService.create({
          data: { businessId: fx.businessId, name: `Masaža ${RUN}`, steps: [{ kind: "busy", minutes: 30 }] },
        });
        inserted.resolve();
        await release.promise;
      },
      { timeout: 20_000 }
    );
    await inserted.promise;
    const second = codeOf(saveService(prisma, fx.olga, fresh(`Masaža ${RUN}`)));
    // Wait until the second save is blocked on the index (a lock not granted), i.e. past its read.
    let waiting = 0;
    for (let i = 0; i < 100 && waiting === 0; i += 1) {
      await sleep(50);
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'`;
      waiting = Number(rows[0].n);
    }
    expect(waiting).toBeGreaterThan(0);
    release.resolve();
    await first;
    expect(await second).toBe("service_name_taken");
    const masaze = await prisma.flowkoService.findMany({
      where: { businessId: fx.businessId, name: `Masaža ${RUN}` },
      select: { id: true },
    });
    expect(masaze).toHaveLength(1);
  });

  // Flowko U29e: E8, R15 — the price round trip on Postgres (int4 column, no CHECK: the read guard is the code's).
  it("E8: a price is stored, changed and cleared; a stored -5 or 10_000_000 reads as null", async () => {
    const input = (priceCents: number | null, id?: number): SaveServiceInput => ({
      ...(id !== undefined ? { id } : {}),
      name: `Cena ${RUN}`,
      category: null,
      steps: [{ kind: "busy", minutes: 30 }],
      workerMemberIds: [],
      priceCents,
    });
    const { serviceId } = await saveService(prisma, fx.olga, input(2550));
    const stored = async () =>
      (await prisma.flowkoService.findUnique({ where: { id: serviceId }, select: { priceCents: true } }))
        ?.priceCents;
    const listed = async () =>
      (await listServicesForOwner(prisma, fx.olga, NOW)).services.find((s) => s.id === serviceId)?.priceCents;
    expect(await stored()).toBe(2550);
    expect(await listed()).toBe(2550);
    await saveService(prisma, fx.olga, input(999_999, serviceId));
    expect(await stored()).toBe(999_999);
    await saveService(prisma, fx.olga, input(0, serviceId));
    expect(await stored()).toBe(0);
    expect(await listed()).toBe(0);
    await saveService(prisma, fx.olga, input(null, serviceId));
    expect(await stored()).toBeNull();
    expect(await listed()).toBeNull();
    // A refused price writes nothing.
    expect(await codeOf(saveService(prisma, fx.olga, input(1_000_000, serviceId)))).toBe("bad_service");
    expect(await stored()).toBeNull();
    for (const corrupt of [-5, 10_000_000]) {
      await prisma.flowkoService.update({ where: { id: serviceId }, data: { priceCents: corrupt } });
      expect(await stored()).toBe(corrupt);
      expect(await listed(), String(corrupt)).toBeNull();
    }
    await prisma.flowkoService.delete({ where: { id: serviceId } });
  });
});

// Flowko U29c: P2 — the business row FOR NO KEY UPDATE first in saveService, reorderServices and removeService. A fresh
// business (template services only), so the rounds cannot touch the fixture above.
describe("U29c services: the business row lock", () => {
  async function freshBusiness(label: string): Promise<{ businessId: number; owner: number }> {
    const owner = await realUser(`Own${label}`);
    const { businessId } = await createBusiness(prisma, {
      ownerUserId: owner,
      name: `Salon ${label} ${RUN}`,
      slug: `salon-${label.toLowerCase()}-${RUN}`,
      templateId: "hair-salon",
      phone: "01 234 56 78",
      address: "Glavna ulica 1, Ljubljana",
    });
    return { businessId, owner };
  }
  const plain = (name: string): SaveServiceInput => ({
    name,
    category: null,
    steps: [{ kind: "busy", minutes: 30 }],
    workerMemberIds: [],
    priceCents: null, // Flowko U29e: E8
  });
  const positionsOf = async (businessId: number) =>
    (
      await prisma.flowkoService.findMany({
        where: { businessId },
        select: { position: true },
        orderBy: { id: "asc" },
      })
    ).map((r) => r.position);

  it("20 rounds of Barvanje-style case variants: exactly one saved, one service_name_taken", async () => {
    const { businessId, owner } = await freshBusiness("Case");
    for (let round = 0; round < 20; round += 1) {
      const results = await Promise.all([
        codeOf(saveService(prisma, owner, plain(`Okras ${round}`))),
        codeOf(saveService(prisma, owner, plain(`okras ${round}`))),
      ]);
      expect(results.sort(), `round ${round}`).toEqual(["ok", "service_name_taken"]);
      const same = await prisma.flowkoService.findMany({
        where: { businessId, name: { in: [`Okras ${round}`, `okras ${round}`] } },
        select: { id: true },
      });
      expect(same, `round ${round}`).toHaveLength(1);
    }
  });

  it("parallel new saves and reorders never leave two services on one position", async () => {
    const { businessId, owner } = await freshBusiness("Pos");
    for (let round = 0; round < 10; round += 1) {
      const before = (
        await prisma.flowkoService.findMany({
          where: { businessId },
          select: { id: true },
          orderBy: { position: "asc" },
        })
      ).map((r) => r.id);
      const results = await Promise.all([
        codeOf(saveService(prisma, owner, plain(`Nova ${round} a`))),
        codeOf(saveService(prisma, owner, plain(`Nova ${round} b`))),
        codeOf(reorderServices(prisma, owner, [...before].reverse())),
      ]);
      // The reorder is "ok" when it ran first, bad_service when a save had already changed the set.
      expect(["ok", "bad_service"]).toContain(results[2]);
      expect(results[0]).toBe("ok");
      expect(results[1]).toBe("ok");
      const positions = await positionsOf(businessId);
      expect(new Set(positions).size, `round ${round}: ${positions.join(",")}`).toBe(positions.length);
    }
  });

  it("a remove and a save in parallel leave the business consistent (no 500, distinct positions)", async () => {
    const { businessId, owner } = await freshBusiness("Rem");
    const first = await prisma.flowkoService.findFirst({
      where: { businessId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (!first) throw new Error("fixture: no service");
    const results = await Promise.all([
      codeOf(removeService(prisma, owner, first.id)),
      codeOf(saveService(prisma, owner, plain("Po odstranitvi"))),
    ]);
    expect(results).toEqual(["ok", "ok"]);
    const positions = await positionsOf(businessId);
    expect(new Set(positions).size).toBe(positions.length);
  });

  // Final review DATA-1: FOR UPDATE on the business row conflicts with FOR KEY SHARE, which a booking's step insert
  // takes on the service row and its action insert on the business row (FK checks). removeService (delete = FOR
  // UPDATE on the service row, case-only rename = the same through the unique index) holding the business lock
  // then deadlocked with the writer: 40P01. FOR NO KEY UPDATE is compatible with FOR KEY SHARE.
  describe("DATA-1: a booking's KEY SHARE locks never deadlock with the business lock", () => {
    async function bookableBusiness(label: string) {
      const { businessId, owner } = await freshBusiness(label);
      await prisma.flowkoBusiness.update({ where: { id: businessId }, data: { openHolidays: [] } });
      const ana = await addLoginMember(
        prisma,
        businessId,
        await realUser(`Ana${label}`),
        FlowkoBusinessRole.WORKER
      );
      await setUsualWeek(prisma, owner, {
        memberId: ana.memberId,
        usualWeek: week([{ from: "08:00", to: "16:00" }]),
        confirmOutsideOpening: false,
      });
      return { businessId, owner, ana: ana.memberId };
    }
    const bookingFor = (ana: number, serviceId: number, start: Date, who: string): CreateBookingInput => ({
      workerMemberId: ana,
      serviceIds: [serviceId],
      start,
      customer: { name: "Marija Novak", phone: "041 123 456", email: `${who}-${RUN}@example.com` },
      confirmOverride: false,
    });

    /**
     * The writer's position by hand: this transaction holds FOR KEY SHARE on the service row (the step insert's FK
     * check) while `owner` write starts, holds the business lock and waits on that service row; then the action
     * insert (FOR KEY SHARE on the business row) must go through. Before the fix: 40P01 on one side after ~1 s.
     */
    async function writerHoldsServiceThenInsertsAction(
      serviceId: number,
      bookingId: number,
      businessId: number,
      ownerWrite: () => Promise<unknown>
    ) {
      let ownerSide: Promise<unknown> | undefined;
      const writerSide = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT 1 FROM "FlowkoService" WHERE "id" = ${serviceId} FOR KEY SHARE`;
          ownerSide = ownerWrite();
          ownerSide.catch(() => undefined); // judged below through allSettled
          await sleep(400); // the owner side now holds the business lock and waits on the service row
          await tx.flowkoBookingAction.create({
            data: { bookingId, businessId, action: "CREATED", actorName: "test" },
          });
        },
        { timeout: 30_000 }
      );
      // The tx callback has run by the time it settles, so `ownerSide` is set (the owner write waits on the tx).
      const [writer] = await Promise.allSettled([writerSide]);
      const [owner] = await Promise.allSettled([ownerSide ?? Promise.resolve()]);
      return [writer, owner];
    }

    async function firstBooking(label: string) {
      const { businessId, owner, ana } = await bookableBusiness(label);
      const anchor = await saveService(prisma, owner, { ...plain(`Anker ${label}`), workerMemberIds: [ana] });
      const booked = await createBusinessBooking(
        prisma,
        owner,
        bookingFor(ana, anchor.serviceId, at(TUE, "09:00"), `anker-${label}`),
        NOW,
        quiet
      );
      if (booked.status !== "created")
        throw new Error(`fixture: expected created, got ${JSON.stringify(booked)}`);
      return { businessId, owner, ana, bookingId: booked.bookingId };
    }

    it("removeService while a booking holds KEY SHARE on the service: both finish, the service is gone", async () => {
      const { businessId, owner, ana, bookingId } = await firstBooking("DetRem");
      const victim = await saveService(prisma, owner, { ...plain("Za odstranitev"), workerMemberIds: [ana] });
      const settled = await writerHoldsServiceThenInsertsAction(victim.serviceId, bookingId, businessId, () =>
        removeService(prisma, owner, victim.serviceId)
      );
      expect(settled.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await prisma.flowkoService.findUnique({ where: { id: victim.serviceId } })).toBeNull();
    });

    it("a case-only rename while a booking holds KEY SHARE on the service: both finish, the name changed", async () => {
      const { businessId, owner, ana, bookingId } = await firstBooking("DetRen");
      const target = await saveService(prisma, owner, {
        ...plain(`striženje ${RUN}`),
        workerMemberIds: [ana],
      });
      const settled = await writerHoldsServiceThenInsertsAction(target.serviceId, bookingId, businessId, () =>
        saveService(prisma, owner, {
          ...plain(`Striženje ${RUN}`),
          id: target.serviceId,
          workerMemberIds: [ana],
        })
      );
      expect(settled.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const row = await prisma.flowkoService.findUnique({
        where: { id: target.serviceId },
        select: { name: true },
      });
      expect(row?.name).toBe(`Striženje ${RUN}`);
    });

    it("20 rounds: a booking writer racing removeService of its service: no deadlock, no 500", async () => {
      const { owner, ana } = await bookableBusiness("RaceRem");
      const outcomes = { created: 0, gone: 0 };
      for (let round = 0; round < 20; round += 1) {
        const victim = await saveService(prisma, owner, {
          ...plain(`Runda ${round}`),
          workerMemberIds: [ana],
        });
        // A distinct Tuesday per round, so a committed booking never blocks the next round's slot.
        const day = new Date(Date.parse(`${TUE}T00:00:00Z`) + round * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const [booking, removal] = await Promise.allSettled([
          createBusinessBooking(
            prisma,
            owner,
            bookingFor(ana, victim.serviceId, at(day, "09:00"), `race-${round}`),
            NOW,
            quiet
          ),
          removeService(prisma, owner, victim.serviceId),
        ]);
        const text = (r: PromiseSettledResult<unknown>) =>
          r.status === "rejected"
            ? `${String(r.reason)} ${JSON.stringify((r.reason as { meta?: unknown })?.meta)}`
            : "";
        expect(`${text(booking)}${text(removal)}`, `round ${round}`).not.toMatch(/40P01|deadlock/i);
        expect(removal.status, `round ${round}: removal ${text(removal)}`).toBe("fulfilled");
        if (booking.status === "fulfilled") {
          expect(booking.value.status, `round ${round}`).toBe("created");
          outcomes.created += 1;
        } else {
          expect(booking.reason, `round ${round}: ${text(booking)}`).toBeInstanceOf(FlowkoBusinessError);
          expect((booking.reason as FlowkoBusinessError).code, `round ${round}`).toBe("service_not_assigned");
          outcomes.gone += 1;
        }
        expect(
          await prisma.flowkoService.findUnique({ where: { id: victim.serviceId } }),
          `round ${round}`
        ).toBeNull();
      }
      expect(outcomes.created + outcomes.gone).toBe(20);
    }, 180_000);
  });
});
