// Flowko U29c: the owner's „Delavci“ list on prismock (W1). Business A (owner Olga; workers Ana, Bor and Dan
// (LOCKED); desk-only worker Mojca; staff Rok with a login; staff Sara without a login) and B (owner Zala,
// worker Bea). NOW = 2026-11-16T07:07:00Z (Mon 08:07 in Ljubljana). Covers: who may read (owner only), every
// member in position order with status and flags, the mirror-based future-booking count for every column member,
// the booking details for LOCKED members only (local date and time across a DST change, distinct services in
// step order, first attendee), which bookings count (holding, not over, on the mirror), the 50-item cap, and
// that no uid, e-mail, phone or user id appears in the answer. Real concurrency and joins: workers.integration-test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; workers.ts takes `db` and never imports it.
import "@calcom/prisma";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it } from "vitest";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { listWorkers } from "./workers";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const MIN = 60_000;

let seq = 0;
async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Who = "olga" | "ana" | "bor" | "dan" | "mojca" | "rok" | "sara" | "zala" | "bea";
type Fixture = {
  a: number;
  users: Record<"olga" | "ana" | "bor" | "dan" | "rok" | "zala" | "bea", number>;
  members: Record<Who, number>;
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
  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const dan = await makeUser("Dan");
  const rok = await makeUser("Rok");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, a, bor, FlowkoBusinessRole.WORKER);
  const danMember = await addLoginMember(db, a, dan, FlowkoBusinessRole.WORKER);
  const mojcaMember = await createDeskOnlyWorker(db, a, "Mojca");
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);
  const saraMember = await addStaffWithoutLogin(db, a, "Sara");
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
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

  return {
    a,
    users: { olga, ana, bor, dan, rok, zala, bea },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      dan: danMember.memberId,
      mojca: mojcaMember.memberId,
      rok: rokMember.memberId,
      sara: (saraMember as { memberId: number }).memberId,
      zala: createdB.ownerMemberId,
      bea: beaMember.memberId,
    },
  };
}

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

let seqBooking = 0;
type BookingSpec = {
  start: Date;
  minutes?: number;
  status?: BookingStatus;
  services?: string[];
  customers?: string[];
};
/** A business booking on `memberId`'s mirror (one step per service name, in order), customers as attendees. */
async function bookingOn(memberId: number, spec: BookingSpec): Promise<number> {
  seqBooking += 1;
  const mirror = await ensureWorkerMirror(tx, memberId);
  const member = await prismock.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: { userId: true },
  });
  const minutes = spec.minutes ?? 60;
  const booking = await prismock.booking.create({
    data: {
      uid: `u29c-wk-${seqBooking}`,
      title: "Termin",
      startTime: spec.start,
      endTime: new Date(spec.start.getTime() + minutes * MIN),
      eventTypeId: mirror.eventTypeId,
      userId: member?.userId ?? null,
      status: spec.status ?? BookingStatus.ACCEPTED,
    },
    select: { id: true },
  });
  const services = spec.services ?? ["Striženje"];
  for (let index = 0; index < services.length; index += 1) {
    await prismock.flowkoBookingStep.create({
      data: {
        bookingId: booking.id,
        index,
        kind: "busy",
        startTime: new Date(spec.start.getTime() + index * 30 * MIN),
        endTime: new Date(spec.start.getTime() + (index + 1) * 30 * MIN),
        serviceId: null,
        serviceName: services[index],
      },
    });
  }
  for (const name of spec.customers ?? ["Marija Novak"]) {
    await prismock.attendee.create({
      data: {
        bookingId: booking.id,
        name,
        email: `${name.replace(/\s/g, ".").toLowerCase()}@example.com`,
        timeZone: TZ,
        phoneNumber: "041 123 456",
      },
    });
  }
  return booking.id;
}

function keysDeep(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("listWorkers (W1 workers.list)", () => {
  it("lists every member in position order with role, status and flags", async () => {
    const { members } = await listWorkers(db, f.users.olga, NOW);

    expect(members.map((m) => [m.displayName, m.role, m.status, m.noLogin, m.isMe])).toEqual([
      ["Olga", "OWNER", "ACTIVE", false, true],
      ["Ana", "WORKER", "ACTIVE", false, false],
      ["Bor", "WORKER", "ACTIVE", false, false],
      ["Dan", "WORKER", "LOCKED", false, false],
      ["Mojca", "WORKER", "ACTIVE", true, false],
      ["Rok", "STAFF", "ACTIVE", false, false],
      ["Sara", "STAFF", "ACTIVE", true, false],
    ]);
    expect(members.map((m) => m.memberId)).toEqual([
      f.members.olga,
      f.members.ana,
      f.members.bor,
      f.members.dan,
      f.members.mojca,
      f.members.rok,
      f.members.sara,
    ]);
    // Nothing booked yet.
    expect(
      members.every((m) => m.futureCount === 0 && m.moreBookings === 0 && m.futureBookings.length === 0)
    ).toBe(true);
  });

  it("follows the stored position, then the id", async () => {
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.dan }, data: { position: 0 } });
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.olga }, data: { position: 9 } });
    const { members } = await listWorkers(db, f.users.olga, NOW);
    // Dan moved to position 0 and Olga to 9; the others keep theirs.
    expect(members.map((m) => m.displayName)).toEqual(["Dan", "Ana", "Bor", "Mojca", "Rok", "Sara", "Olga"]);
  });

  it("answers the owner only: a worker, a staff member, a locked member and a stranger are forbidden", async () => {
    expect(await outcome(listWorkers(db, f.users.ana, NOW))).toBe("forbidden");
    expect(await outcome(listWorkers(db, f.users.rok, NOW))).toBe("forbidden");
    expect(await outcome(listWorkers(db, f.users.dan, NOW))).toBe("forbidden");
    expect(await outcome(listWorkers(db, await makeUser("Nobody"), NOW))).toBe("forbidden");
  });

  it("never mixes in another business's members or bookings", async () => {
    const bea = (await prismock.flowkoBusinessMember.findFirst({ where: { userId: f.users.bea } }))
      ?.id as number;
    await bookingOn(bea, { start: at("2026-11-17", "10:00") });
    const { members } = await listWorkers(db, f.users.olga, NOW);
    expect(members.map((m) => m.displayName)).not.toContain("Bea");
    expect(members.every((m) => m.futureCount === 0)).toBe(true);
    const other = await listWorkers(db, f.users.zala, NOW);
    expect(other.members.map((m) => [m.displayName, m.futureCount])).toEqual([
      ["Zala", 0],
      ["Bea", 1],
    ]);
  });

  it("counts the future business bookings of every column member; details only for LOCKED ones", async () => {
    await bookingOn(f.members.ana, { start: at("2026-11-17", "10:00") });
    await bookingOn(f.members.ana, { start: at("2026-11-18", "10:00") });
    await bookingOn(f.members.mojca, { start: at("2026-11-17", "11:00") });
    await bookingOn(f.members.olga, { start: at("2026-11-19", "09:00") });
    const { members } = await listWorkers(db, f.users.olga, NOW);
    const by = Object.fromEntries(members.map((m) => [m.displayName, m]));
    expect([by.Olga.futureCount, by.Ana.futureCount, by.Bor.futureCount, by.Mojca.futureCount]).toEqual([
      1, 2, 0, 1,
    ]);
    expect([by.Rok.futureCount, by.Sara.futureCount]).toEqual([0, 0]); // STAFF: no column
    for (const name of ["Olga", "Ana", "Bor", "Mojca", "Rok", "Sara"]) {
      expect(by[name].futureBookings).toEqual([]);
      expect(by[name].moreBookings).toBe(0);
    }
  });

  it("lists a LOCKED worker's bookings in time order with local date and time, distinct services and the first attendee", async () => {
    const later = await bookingOn(f.members.dan, {
      start: at("2026-11-19", "14:30"),
      minutes: 45,
      services: ["Barvanje", "Feniranje", "Barvanje"],
      customers: ["Eva Zupan", "Janez Zupan"],
    });
    const first = await bookingOn(f.members.dan, {
      start: at("2026-11-17", "10:00"),
      services: ["Striženje", "Feniranje"],
      customers: ["Ana Testna"],
    });
    const { members } = await listWorkers(db, f.users.olga, NOW);
    const dan = members.find((m) => m.memberId === f.members.dan);
    expect(dan?.futureCount).toBe(2);
    expect(dan?.moreBookings).toBe(0);
    expect(dan?.futureBookings).toEqual([
      {
        bookingId: first,
        date: "2026-11-17",
        from: "10:00",
        to: "11:00",
        services: ["Striženje", "Feniranje"],
        customerName: "Ana Testna",
      },
      {
        bookingId: later,
        date: "2026-11-19",
        from: "14:30",
        to: "15:15",
        services: ["Barvanje", "Feniranje"],
        customerName: "Eva Zupan",
      },
    ]);
  });

  it("shows local wall time across the DST change (2027-03-28 10:00 local is 10:00)", async () => {
    // 2027-03-28 is the spring-forward Sunday: UTC offset +01 before 02:00, +02 after.
    await bookingOn(f.members.dan, { start: at("2027-03-28", "10:00") });
    await bookingOn(f.members.dan, { start: at("2027-03-27", "23:30"), minutes: 60 }); // ends 00:30 next day
    const dan = (await listWorkers(db, f.users.olga, NOW)).members.find((m) => m.memberId === f.members.dan);
    expect(dan?.futureBookings.map((b) => [b.date, b.from, b.to])).toEqual([
      ["2027-03-27", "23:30", "00:30"],
      ["2027-03-28", "10:00", "11:00"],
    ]);
  });

  it("counts holding bookings that are not over: cancelled, rejected and ended ones are out, an ongoing one is in", async () => {
    await bookingOn(f.members.dan, { start: at("2026-11-17", "10:00"), status: BookingStatus.ACCEPTED });
    await bookingOn(f.members.dan, { start: at("2026-11-17", "12:00"), status: BookingStatus.PENDING });
    await bookingOn(f.members.dan, { start: at("2026-11-17", "13:00"), status: BookingStatus.AWAITING_HOST });
    await bookingOn(f.members.dan, { start: at("2026-11-17", "14:00"), status: BookingStatus.CANCELLED });
    await bookingOn(f.members.dan, { start: at("2026-11-17", "15:00"), status: BookingStatus.REJECTED });
    // Ended: ends exactly at now (07:07Z) -> out; ongoing: started 07:00Z, ends 07:30Z -> in.
    await bookingOn(f.members.dan, { start: new Date(NOW.getTime() - 60 * MIN), minutes: 60 });
    const ongoing = await bookingOn(f.members.dan, { start: new Date(NOW.getTime() - 7 * MIN), minutes: 30 });
    await bookingOn(f.members.ana, { start: new Date(NOW.getTime() - 120 * MIN), minutes: 60 });
    await bookingOn(f.members.ana, { start: at("2026-11-17", "10:00"), status: BookingStatus.CANCELLED });
    const { members } = await listWorkers(db, f.users.olga, NOW);
    const dan = members.find((m) => m.memberId === f.members.dan);
    expect(dan?.futureCount).toBe(4);
    expect(dan?.futureBookings.map((b) => b.bookingId)).toContain(ongoing);
    expect(dan?.futureBookings).toHaveLength(4);
    expect(members.find((m) => m.memberId === f.members.ana)?.futureCount).toBe(0);
  });

  it("counts only the mirror: a private Cal booking of the worker is invisible", async () => {
    await bookingOn(f.members.dan, { start: at("2026-11-17", "10:00") });
    // A private booking organised by Dan on his own Cal event type (no mirror) and one with no event type.
    const own = await prismock.eventType.create({
      data: { title: "Private", slug: "private-dan", length: 30, userId: f.users.dan },
      select: { id: true },
    });
    for (const eventTypeId of [own.id, null]) {
      await prismock.booking.create({
        data: {
          uid: `u29c-private-${eventTypeId}`,
          title: "Private",
          startTime: at("2026-11-18", "10:00"),
          endTime: at("2026-11-18", "11:00"),
          userId: f.users.dan,
          eventTypeId,
          status: BookingStatus.ACCEPTED,
        },
      });
    }
    const dan = (await listWorkers(db, f.users.olga, NOW)).members.find((m) => m.memberId === f.members.dan);
    expect(dan?.futureCount).toBe(1);
    expect(dan?.futureBookings).toHaveLength(1);
  });

  it("a member who never had a booking (no mirror yet) has 0 and an empty list", async () => {
    const dan = (await listWorkers(db, f.users.olga, NOW)).members.find((m) => m.memberId === f.members.dan);
    expect(dan).toMatchObject({ futureCount: 0, futureBookings: [], moreBookings: 0 });
  });

  it("caps a LOCKED member's list at 50 and counts the rest in moreBookings", async () => {
    for (let i = 0; i < 51; i += 1) {
      await bookingOn(f.members.dan, {
        start: new Date(at("2026-11-17", "08:00").getTime() + i * 60 * MIN),
        minutes: 30,
      });
    }
    const dan = (await listWorkers(db, f.users.olga, NOW)).members.find((m) => m.memberId === f.members.dan);
    expect(dan?.futureCount).toBe(51);
    expect(dan?.futureBookings).toHaveLength(50);
    expect(dan?.moreBookings).toBe(1);
    // The earliest 50, in order.
    const starts = dan?.futureBookings.map((b) => `${b.date} ${b.from}`) ?? [];
    expect(starts[0]).toBe("2026-11-17 08:00");
    expect([...starts].sort()).toEqual(starts);
  });

  it("returns no uid, e-mail, phone or user id anywhere (deep key scan and value scan)", async () => {
    await bookingOn(f.members.dan, { start: at("2026-11-17", "10:00"), customers: ["Ana Testna"] });
    await bookingOn(f.members.ana, { start: at("2026-11-17", "11:00") });
    const answer = await listWorkers(db, f.users.olga, NOW);
    const keys = keysDeep(answer);
    for (const banned of ["uid", "email", "phone", "phoneNumber", "userId", "user", "username"]) {
      expect(keys.has(banned)).toBe(false);
    }
    const json = JSON.stringify(answer);
    expect(json).not.toContain("@");
    expect(json).not.toContain("041 123 456");
    expect(json).not.toContain("u29c-wk-");
    expect([...keys].sort()).toEqual(
      [
        "bookingId",
        "customerName",
        "date",
        "displayName",
        "from",
        "futureBookings",
        "futureCount",
        "isMe",
        "memberId",
        "members",
        "moreBookings",
        "noLogin",
        "role",
        "services",
        "status",
        "to",
      ].sort()
    );
  });
});
