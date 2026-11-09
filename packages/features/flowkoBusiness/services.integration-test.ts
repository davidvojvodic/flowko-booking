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
import { listServicesForOwner, removeService, type SaveServiceInput, saveService } from "./services";

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
});
