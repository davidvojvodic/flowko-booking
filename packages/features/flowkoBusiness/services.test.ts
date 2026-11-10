// Flowko U29a: the owner's service catalogue on prismock (S8–S13). Business A (owner Olga; workers Ana, Bor and
// Dan (LOCKED); desk-only worker Mojca; staff Rok with a login; hair-salon template, every template service done
// by Olga) and B (owner Zala, worker Bea). NOW = 2026-11-16T07:07:00Z (Mon 08:07 in Ljubljana). Covers the owner
// list (column members, who does what, future bookings), save (fields, caps, case-insensitive names, position,
// price and online flag untouched), who does it (LOCKED assignments kept, never added; STAFF/foreign/LOCKED named
// → bad_member), reorder, remove, and rights (owner only; another business's ids → forbidden). Prismock ignores
// rollbacks, FK actions and unique indexes: the P2002 mapping, the SET NULL on booking steps and the atomic
// refusals are proven on Postgres in services.integration-test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; services.ts takes `db` and never imports it.
import "@calcom/prisma";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import {
  listServicesForOwner,
  removeService,
  reorderServices,
  type SaveServiceInput,
  saveService,
  setServiceWorkersKeepingLocked,
} from "./services";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const BARVANJE_STEPS = [
  { kind: "busy" as const, minutes: 30 },
  { kind: "processing" as const, minutes: 40 },
  { kind: "busy" as const, minutes: 30 },
];
const TEMPLATE_NAMES = [
  "Moško striženje",
  "Žensko striženje",
  "Otroško striženje",
  "Barvanje",
  "Pramenčki",
  "Feniranje",
];

let seq = 0;
async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Who = "olga" | "ana" | "bor" | "dan" | "mojca" | "rok" | "zala" | "bea";
type Fixture = {
  a: number;
  b: number;
  users: Record<Exclude<Who, "mojca">, number>;
  members: Record<Who, number>;
  services: Record<string, number>;
  bServices: Record<string, number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `salon-a-${seq}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
  });
  const a = created.businessId;
  await prismock.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [] } });
  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const dan = await makeUser("Dan");
  const rok = await makeUser("Rok");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, a, bor, FlowkoBusinessRole.WORKER);
  const danMember = await addLoginMember(db, a, dan, FlowkoBusinessRole.WORKER);
  const mojcaMember = await createDeskOnlyWorker(db, a, "Mojca");
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);

  const zala = await makeUser("Zala");
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `salon-b-${seq}`,
    templateId: "hair-salon",
    phone: "02 345 67 89",
  });
  await prismock.flowkoBusiness.update({ where: { id: createdB.businessId }, data: { openHolidays: [] } });
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

  const byName = (ids: number[]) =>
    Object.fromEntries(TEMPLATE_NAMES.map((name, i) => [name, ids[i]])) as Record<string, number>;
  const services = byName(created.serviceIds);

  // Barvanje: Olga, Ana, Bor and Dan; then Dan is locked (the lock keeps his assignments).
  for (const memberId of [anaMember.memberId, borMember.memberId, danMember.memberId]) {
    await prismock.flowkoServiceWorker.create({ data: { serviceId: services.Barvanje, memberId } });
  }
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  await prismock.user.update({ where: { id: dan }, data: { locked: true } });

  return {
    a,
    b: createdB.businessId,
    users: { olga, ana, bor, dan, rok, zala, bea },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      dan: danMember.memberId,
      mojca: mojcaMember.memberId,
      rok: rokMember.memberId,
      zala: createdB.ownerMemberId,
      bea: beaMember.memberId,
    },
    services,
    bServices: byName(createdB.serviceIds),
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

beforeEach(async () => {
  f = await setUp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** What Prisma throws when another device removed the row between the transaction's read and its write. */
const recordGone = () =>
  new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
    code: "P2025",
    clientVersion: "test",
  });

const barvanje = (over: Partial<SaveServiceInput> = {}): SaveServiceInput => ({
  id: f.services.Barvanje,
  name: "Barvanje",
  category: "Barvanje",
  steps: BARVANJE_STEPS,
  workerMemberIds: [f.members.olga, f.members.ana, f.members.bor],
  ...over,
});

async function assignedTo(serviceId: number): Promise<number[]> {
  const rows = await prismock.flowkoServiceWorker.findMany({
    where: { serviceId },
    select: { memberId: true },
  });
  return rows.map((r) => r.memberId).sort((x, y) => x - y);
}

async function serviceRow(id: number) {
  return prismock.flowkoService.findUnique({ where: { id } });
}

let seqBooking = 0;
/** A business booking on `memberId`'s mirror with one step row per service id. */
async function bookingWith(
  memberId: number,
  serviceIds: Array<number | null>,
  start: Date,
  status: BookingStatus = BookingStatus.ACCEPTED
): Promise<number> {
  seqBooking += 1;
  const mirror = await ensureWorkerMirror(tx, memberId);
  const member = await prismock.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: { userId: true },
  });
  const end = new Date(start.getTime() + serviceIds.length * 30 * 60_000);
  const booking = await prismock.booking.create({
    data: {
      uid: `u29a-svc-${seqBooking}`,
      title: "Termin",
      startTime: start,
      endTime: end,
      eventTypeId: mirror.eventTypeId,
      userId: member?.userId ?? null,
      status,
    },
    select: { id: true },
  });
  for (let index = 0; index < serviceIds.length; index += 1) {
    await prismock.flowkoBookingStep.create({
      data: {
        bookingId: booking.id,
        index,
        kind: "busy",
        startTime: new Date(start.getTime() + index * 30 * 60_000),
        endTime: new Date(start.getTime() + (index + 1) * 30 * 60_000),
        serviceId: serviceIds[index],
        serviceName: "Kopija",
      },
    });
  }
  return booking.id;
}

describe("listServicesForOwner (S14 services.list)", () => {
  it("lists the services in order with who does them, the column members and the future bookings", async () => {
    const view = await listServicesForOwner(db, f.users.olga, NOW);

    expect(view.members).toEqual([
      { memberId: f.members.olga, displayName: "Olga", role: "OWNER", status: "ACTIVE", deskOnly: false },
      { memberId: f.members.ana, displayName: "Ana", role: "WORKER", status: "ACTIVE", deskOnly: false },
      { memberId: f.members.bor, displayName: "Bor", role: "WORKER", status: "ACTIVE", deskOnly: false },
      { memberId: f.members.dan, displayName: "Dan", role: "WORKER", status: "LOCKED", deskOnly: false },
      { memberId: f.members.mojca, displayName: "Mojca", role: "WORKER", status: "ACTIVE", deskOnly: true },
    ]);
    expect(view.services.map((s) => s.name)).toEqual(TEMPLATE_NAMES);
    expect(view.services.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);

    const colouring = view.services.find((s) => s.name === "Barvanje");
    expect(colouring).toEqual({
      id: f.services.Barvanje,
      name: "Barvanje",
      category: "Barvanje",
      steps: BARVANJE_STEPS,
      totalMinutes: 100,
      position: 3,
      workers: [
        { memberId: f.members.olga, displayName: "Olga", status: "ACTIVE", deskOnly: false, assigned: true },
        { memberId: f.members.ana, displayName: "Ana", status: "ACTIVE", deskOnly: false, assigned: true },
        { memberId: f.members.bor, displayName: "Bor", status: "ACTIVE", deskOnly: false, assigned: true },
        { memberId: f.members.dan, displayName: "Dan", status: "LOCKED", deskOnly: false, assigned: true },
        {
          memberId: f.members.mojca,
          displayName: "Mojca",
          status: "ACTIVE",
          deskOnly: true,
          assigned: false,
        },
      ],
      futureBookings: 0,
      broken: false, // Flowko U29c: P4
    });
    // Rok (STAFF) has no column: never a candidate.
    expect(view.members.some((m) => m.memberId === f.members.rok)).toBe(false);
  });

  // Flowko U29c: P4 — corrupt stored steps must not lock the owner out of the whole catalogue.
  it("a row with corrupt steps is returned with steps [] and broken: true; the others are intact", async () => {
    await prismock.flowkoService.update({ where: { id: f.services.Barvanje }, data: { steps: { x: 1 } } });
    const view = await listServicesForOwner(db, f.users.olga, NOW);
    expect(view.services.map((s) => s.name)).toEqual(TEMPLATE_NAMES);
    const broken = view.services.find((s) => s.id === f.services.Barvanje);
    expect(broken).toMatchObject({ name: "Barvanje", steps: [], totalMinutes: 0, broken: true });
    expect(broken?.workers.filter((w) => w.assigned).map((w) => w.memberId)).toEqual([
      f.members.olga,
      f.members.ana,
      f.members.bor,
      f.members.dan,
    ]);
    const others = view.services.filter((s) => s.id !== f.services.Barvanje);
    expect(others).toHaveLength(TEMPLATE_NAMES.length - 1);
    expect(others.every((s) => s.broken === false && s.steps.length > 0)).toBe(true);
  });

  it("futureBookings counts holding business bookings ending after now, once per booking", async () => {
    const tue = "2026-11-17";
    await bookingWith(f.members.ana, [f.services.Barvanje], at(tue, "09:00"));
    // Two steps of one service in one booking: one booking.
    await bookingWith(f.members.bor, [f.services.Barvanje, f.services.Barvanje], at(tue, "10:00"));
    await bookingWith(f.members.ana, [f.services.Barvanje], at(tue, "12:00"), BookingStatus.PENDING);
    // Not counted: cancelled, rejected, ended before now, another service, a removed service's copy.
    await bookingWith(f.members.ana, [f.services.Barvanje], at(tue, "14:00"), BookingStatus.CANCELLED);
    await bookingWith(f.members.ana, [f.services.Barvanje], at(tue, "15:00"), BookingStatus.REJECTED);
    await bookingWith(f.members.ana, [f.services.Barvanje], at("2026-11-16", "07:00"));
    await bookingWith(f.members.ana, [f.services.Feniranje, null], at(tue, "16:00"));
    // Still running at now (Mon 08:07, ends 08:30): counted.
    await bookingWith(f.members.olga, [f.services.Barvanje], at("2026-11-16", "08:00"));
    // Business B's booking of its own Barvanje never reaches A.
    await bookingWith(f.members.bea, [f.bServices.Barvanje], at(tue, "09:00"));

    const view = await listServicesForOwner(db, f.users.olga, NOW);
    const count = (name: string) => view.services.find((s) => s.name === name)?.futureBookings;
    expect(count("Barvanje")).toBe(4);
    expect(count("Feniranje")).toBe(1);
    expect(count("Pramenčki")).toBe(0);
    const viewB = await listServicesForOwner(db, f.users.zala, NOW);
    expect(viewB.services.find((s) => s.name === "Barvanje")?.futureBookings).toBe(1);
  });

  it("orders by position, then id", async () => {
    await prismock.flowkoService.update({ where: { id: f.services.Feniranje }, data: { position: 0 } });
    const view = await listServicesForOwner(db, f.users.olga, NOW);
    expect(view.services.map((s) => s.name).slice(0, 2)).toEqual(["Moško striženje", "Feniranje"]);
  });

  it("only the owner: a worker, staff, a locked member and a stranger are forbidden; B sees only B", async () => {
    for (const userId of [f.users.ana, f.users.rok, f.users.dan, await makeUser("Tujec")]) {
      expect(await outcome(listServicesForOwner(db, userId, NOW))).toBe("forbidden");
    }
    const viewB = await listServicesForOwner(db, f.users.zala, NOW);
    expect(viewB.services.map((s) => s.id).sort()).toEqual(Object.values(f.bServices).sort());
    expect(viewB.members.map((m) => m.memberId)).toEqual([f.members.zala, f.members.bea]);
  });
});

describe("saveService (S8, S9, S13 position)", () => {
  it("creates a service last with its steps, category and workers; price and online flag stay defaults", async () => {
    const result = await saveService(db, f.users.olga, {
      name: "  Trajna  ",
      category: "  ",
      steps: [
        { kind: "busy", minutes: 45 },
        { kind: "processing", minutes: 30 },
        { kind: "busy", minutes: 15 },
      ],
      workerMemberIds: [f.members.ana, f.members.mojca],
    });
    const row = await serviceRow(result.serviceId);
    expect(row).toMatchObject({
      businessId: f.a,
      name: "Trajna",
      category: null,
      steps: [
        { kind: "busy", minutes: 45 },
        { kind: "processing", minutes: 30 },
        { kind: "busy", minutes: 15 },
      ],
      position: 6,
    });
    expect(row?.priceCents ?? null).toBeNull();
    expect(await assignedTo(result.serviceId)).toEqual(
      [f.members.ana, f.members.mojca].sort((x, y) => x - y)
    );
  });

  it("a new service goes after the highest position, not after the count", async () => {
    await prismock.flowkoService.update({ where: { id: f.services.Feniranje }, data: { position: 17 } });
    const { serviceId } = await saveService(db, f.users.olga, {
      name: "Nova",
      category: null,
      steps: [{ kind: "busy", minutes: 30 }],
      workerMemberIds: [],
    });
    expect((await serviceRow(serviceId))?.position).toBe(18);
    // No worker is allowed (the list shows „Nihče“).
    expect(await assignedTo(serviceId)).toEqual([]);
  });

  it("the first service of a business without services gets position 0", async () => {
    await prismock.flowkoServiceWorker.deleteMany({});
    await prismock.flowkoService.deleteMany({ where: { businessId: f.b } });
    const { serviceId } = await saveService(db, f.users.zala, {
      name: "Prva",
      category: null,
      steps: [{ kind: "busy", minutes: 30 }],
      workerMemberIds: [f.members.zala],
    });
    expect((await serviceRow(serviceId))?.position).toBe(0);
  });

  it("an edit changes name, category and steps; price, online flag, grid and position stay", async () => {
    await prismock.flowkoService.update({
      where: { id: f.services.Barvanje },
      data: { priceCents: 4500, onlineBookable: false, slotGridMinutes: 30 },
    });
    const result = await saveService(
      db,
      f.users.olga,
      barvanje({
        name: "Barvanje las",
        category: "Barva",
        steps: [
          { kind: "busy", minutes: 30 },
          { kind: "processing", minutes: 20 },
          { kind: "busy", minutes: 30 },
        ],
      })
    );
    expect(result).toEqual({ serviceId: f.services.Barvanje });
    expect(await serviceRow(f.services.Barvanje)).toMatchObject({
      name: "Barvanje las",
      category: "Barva",
      steps: [
        { kind: "busy", minutes: 30 },
        { kind: "processing", minutes: 20 },
        { kind: "busy", minutes: 30 },
      ],
      priceCents: 4500,
      onlineBookable: false,
      slotGridMinutes: 30,
      position: 3,
    });
  });

  it("names are unique per business case-insensitively (Slovene letters included); B may reuse A's", async () => {
    const fresh = (name: string): SaveServiceInput => ({
      name,
      category: null,
      steps: [{ kind: "busy", minutes: 30 }],
      workerMemberIds: [],
    });
    expect(await outcome(saveService(db, f.users.olga, fresh("barvanje")))).toBe("service_name_taken");
    expect(await outcome(saveService(db, f.users.olga, fresh("  BARVANJE  ")))).toBe("service_name_taken");
    expect(await outcome(saveService(db, f.users.olga, fresh("ŽENSKO STRIŽENJE")))).toBe(
      "service_name_taken"
    );
    // Renaming one service to another's name, in any case.
    expect(await outcome(saveService(db, f.users.olga, barvanje({ name: "pramenčki" })))).toBe(
      "service_name_taken"
    );
    // A service keeps its own name in another case.
    expect(await outcome(saveService(db, f.users.olga, barvanje({ name: "BARVANJE" })))).toBe("ok");
    expect((await serviceRow(f.services.Barvanje))?.name).toBe("BARVANJE");
    // Business B has its own Barvanje already; a new name in A does not clash with B.
    expect(await outcome(saveService(db, f.users.olga, fresh("Samo v A")))).toBe("ok");
    expect(await outcome(saveService(db, f.users.zala, fresh("samo v a")))).toBe("ok");
  });

  it("the editor rules: bad_service for the caps and the U24 step rules, bad_member for a repeated worker", async () => {
    const steps = (n: number) => Array.from({ length: n }, () => ({ kind: "busy" as const, minutes: 30 }));
    const cases: Array<[Partial<SaveServiceInput>, string]> = [
      [{ steps: steps(9) }, "bad_service"],
      [{ steps: [{ kind: "busy", minutes: 485 }] }, "bad_service"],
      [
        {
          steps: [
            { kind: "busy", minutes: 480 },
            { kind: "busy", minutes: 245 },
          ],
        },
        "bad_service",
      ],
      [
        {
          steps: [
            { kind: "processing", minutes: 30 },
            { kind: "busy", minutes: 30 },
          ],
        },
        "bad_service",
      ],
      [{ steps: [{ kind: "busy", minutes: 32 }] }, "bad_service"],
      [{ steps: [] }, "bad_service"],
      [{ name: "x".repeat(61) }, "bad_service"],
      [{ name: "   " }, "bad_service"],
      [{ name: "Barvanje\nlas" }, "bad_service"],
      [{ category: "x".repeat(41) }, "bad_service"],
      [{ workerMemberIds: [f.members.ana, f.members.ana] }, "bad_member"],
      [{ workerMemberIds: [0] }, "bad_member"],
    ];
    for (const [over, code] of cases) {
      expect(await outcome(saveService(db, f.users.olga, barvanje(over))), JSON.stringify(over)).toBe(code);
    }
    // Nothing of it reached the stored service.
    expect(await serviceRow(f.services.Barvanje)).toMatchObject({ name: "Barvanje", steps: BARVANJE_STEPS });
  });

  it("at the caps exactly: 8 steps, a 480-minute step and 720 minutes in total are accepted", async () => {
    const eight = [
      { kind: "busy" as const, minutes: 480 },
      ...Array.from({ length: 6 }, () => ({ kind: "busy" as const, minutes: 35 })),
      { kind: "busy" as const, minutes: 30 },
    ];
    expect(eight.reduce((sum, s) => sum + s.minutes, 0)).toBe(720);
    expect(await outcome(saveService(db, f.users.olga, barvanje({ steps: eight })))).toBe("ok");
    expect((await serviceRow(f.services.Barvanje))?.steps).toEqual(eight);
  });

  it("only the owner; another business's or an unknown service id is forbidden", async () => {
    for (const userId of [f.users.ana, f.users.rok, f.users.dan, await makeUser("Tujec")]) {
      expect(await outcome(saveService(db, userId, barvanje()))).toBe("forbidden");
    }
    expect(await outcome(saveService(db, f.users.olga, barvanje({ id: f.bServices.Barvanje })))).toBe(
      "forbidden"
    );
    expect(await outcome(saveService(db, f.users.olga, barvanje({ id: 999_999 })))).toBe("forbidden");
    expect(await outcome(saveService(db, f.users.olga, barvanje({ id: 2_147_483_648 })))).toBe("forbidden");
    // B's service is unchanged.
    expect((await serviceRow(f.bServices.Barvanje))?.name).toBe("Barvanje");
  });

  it("an edit of a service another device removed after the read (P2025) → forbidden, not a 500", async () => {
    vi.spyOn(prismock.flowkoService, "update").mockRejectedValueOnce(recordGone());
    expect(await outcome(saveService(db, f.users.olga, barvanje({ name: "Barvanje 2" })))).toBe("forbidden");
  });

  it("who does it: STAFF, another business's member, a LOCKED or an unknown member → bad_member", async () => {
    for (const memberId of [f.members.rok, f.members.bea, f.members.dan, 999_999, 2_147_483_648]) {
      expect(
        await outcome(
          saveService(db, f.users.olga, barvanje({ workerMemberIds: [f.members.ana, memberId] }))
        ),
        String(memberId)
      ).toBe("bad_member");
    }
    // A new service naming STAFF is refused before anything is written.
    expect(
      await outcome(
        saveService(db, f.users.olga, {
          name: "Ne nastane",
          category: null,
          steps: [{ kind: "busy", minutes: 30 }],
          workerMemberIds: [f.members.rok],
        })
      )
    ).toBe("bad_member");
    expect(await prismock.flowkoService.findFirst({ where: { name: "Ne nastane" } })).toBeNull();
    // A staff member without a login (no column) as well.
    const tina = await addStaffWithoutLogin(db, f.a, "Tina");
    expect(await outcome(saveService(db, f.users.olga, barvanje({ workerMemberIds: [tina.memberId] })))).toBe(
      "bad_member"
    );
  });

  it("Review Focus 5: a save keeps the LOCKED Dan, removes the unticked, adds the ticked", async () => {
    await saveService(db, f.users.olga, barvanje({ workerMemberIds: [f.members.ana, f.members.mojca] }));
    expect(await assignedTo(f.services.Barvanje)).toEqual(
      [f.members.ana, f.members.dan, f.members.mojca].sort((x, y) => x - y)
    );
    await saveService(db, f.users.olga, barvanje({ workerMemberIds: [] }));
    expect(await assignedTo(f.services.Barvanje)).toEqual([f.members.dan]);
  });
});

describe("setServiceWorkersKeepingLocked (S10)", () => {
  it("never adds a LOCKED member and keeps a stored LOCKED assignment", async () => {
    await setServiceWorkersKeepingLocked(tx, f.a, f.services.Barvanje, [f.members.bor]);
    expect(await assignedTo(f.services.Barvanje)).toEqual(
      [f.members.bor, f.members.dan].sort((x, y) => x - y)
    );
    expect(
      await outcome(setServiceWorkersKeepingLocked(tx, f.a, f.services.Feniranje, [f.members.dan]))
    ).toBe("bad_member");
    expect(await assignedTo(f.services.Feniranje)).toEqual([f.members.olga]);
  });

  it("a service of another business is forbidden", async () => {
    expect(
      await outcome(setServiceWorkersKeepingLocked(tx, f.a, f.bServices.Barvanje, [f.members.ana]))
    ).toBe("forbidden");
    expect(await assignedTo(f.bServices.Barvanje)).toEqual([f.members.zala]);
  });
});

describe("reorderServices (S13)", () => {
  it("rewrites the positions 0..n-1 in the given order", async () => {
    const ids = Object.values(f.services);
    const reversed = Array.from(ids).reverse();
    await reorderServices(db, f.users.olga, reversed);
    const view = await listServicesForOwner(db, f.users.olga, NOW);
    expect(view.services.map((s) => s.id)).toEqual(reversed);
    expect(view.services.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("the list must be exactly the business's services, else bad_service and nothing changes", async () => {
    const ids = Object.values(f.services);
    const cases: number[][] = [
      ids.slice(1),
      [...ids, f.bServices.Barvanje],
      [...ids.slice(1), f.bServices.Barvanje],
      [...ids.slice(1), ids[1]],
      [...ids, 999_999],
      [...ids.slice(1), 2_147_483_648],
      [],
    ];
    for (const list of cases) {
      expect(await outcome(reorderServices(db, f.users.olga, list)), JSON.stringify(list)).toBe(
        "bad_service"
      );
    }
    const view = await listServicesForOwner(db, f.users.olga, NOW);
    expect(view.services.map((s) => s.name)).toEqual(TEMPLATE_NAMES);
  });

  it("only the owner: a worker, staff, a locked member and a stranger are forbidden; B's owner bad_service", async () => {
    const reversed = Array.from(Object.values(f.services)).reverse();
    for (const userId of [f.users.ana, f.users.rok, f.users.dan, await makeUser("Tujec"), f.users.zala]) {
      expect(await outcome(reorderServices(db, userId, reversed)), String(userId)).toBe(
        userId === f.users.zala ? "bad_service" : "forbidden"
      );
    }
    const view = await listServicesForOwner(db, f.users.olga, NOW);
    expect(view.services.map((s) => s.name)).toEqual(TEMPLATE_NAMES);
  });

  it("a service removed by another device during the reorder (P2025) → bad_service", async () => {
    vi.spyOn(prismock.flowkoService, "update").mockRejectedValueOnce(recordGone());
    expect(await outcome(reorderServices(db, f.users.olga, Object.values(f.services)))).toBe("bad_service");
  });
});

describe("removeService (S12)", () => {
  it("the owner removes a service: it leaves the list, B is untouched", async () => {
    await removeService(db, f.users.olga, f.services.Pramenčki);
    expect(await serviceRow(f.services.Pramenčki)).toBeNull();
    const view = await listServicesForOwner(db, f.users.olga, NOW);
    expect(view.services.map((s) => s.name)).toEqual(TEMPLATE_NAMES.filter((n) => n !== "Pramenčki"));
    expect(await serviceRow(f.bServices.Pramenčki)).not.toBeNull();
  });

  it("only the owner; another business's or an unknown service is forbidden", async () => {
    for (const userId of [f.users.ana, f.users.rok, f.users.dan, await makeUser("Tujec")]) {
      expect(await outcome(removeService(db, userId, f.services.Barvanje))).toBe("forbidden");
    }
    for (const serviceId of [f.bServices.Barvanje, 999_999, 2_147_483_648, 0, 1.5]) {
      expect(await outcome(removeService(db, f.users.olga, serviceId)), String(serviceId)).toBe("forbidden");
    }
    expect(await serviceRow(f.bServices.Barvanje)).not.toBeNull();
    expect(await serviceRow(f.services.Barvanje)).not.toBeNull();
  });

  it("a service another device removed after the read (P2025) → forbidden, not a 500", async () => {
    vi.spyOn(prismock.flowkoService, "delete").mockRejectedValueOnce(recordGone());
    expect(await outcome(removeService(db, f.users.olga, f.services.Barvanje))).toBe("forbidden");
  });

  it("any other Prisma error is not mapped", async () => {
    const other = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed.", {
      code: "P2003",
      clientVersion: "test",
    });
    vi.spyOn(prismock.flowkoService, "delete").mockRejectedValueOnce(other);
    await expect(removeService(db, f.users.olga, f.services.Barvanje)).rejects.toBe(other);
  });
});
