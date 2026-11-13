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
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { Prisma } from "@calcom/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { addDeskWorker, listWorkers, reorderWorkers } from "./workers";

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

  // Flowko U29d: narrowed to the member rows (the pending brand-new invites carry the e-mail the owner typed);
  // a desk-only member's open invite adds its expiry keys, never an e-mail. answer.invites has its own exact set.
  it("returns no uid, e-mail, phone or user id anywhere (deep key scan and value scan)", async () => {
    await bookingOn(f.members.dan, { start: at("2026-11-17", "10:00"), customers: ["Ana Testna"] });
    await bookingOn(f.members.ana, { start: at("2026-11-17", "11:00") });
    const invite = (memberId: number | null, email: string, name: string, hash: string) =>
      prismock.flowkoBusinessInvite.create({
        data: {
          businessId: f.a,
          email,
          name,
          role: FlowkoBusinessRole.WORKER,
          memberId,
          tokenHash: hash.repeat(64),
          expiresAt: new Date(NOW.getTime() + 86_400_000),
          createdByUserId: f.users.olga,
        },
      });
    await invite(f.members.mojca, "mojca.real@example.si", "Mojca", "a");
    await invite(null, "hana@example.si", "Hana", "b");
    const answer = await listWorkers(db, f.users.olga, NOW);
    const keys = keysDeep(answer.members);
    for (const banned of ["uid", "email", "phone", "phoneNumber", "userId", "user", "username"]) {
      expect(keys.has(banned)).toBe(false);
    }
    const json = JSON.stringify(answer.members);
    expect(json).not.toContain("@");
    expect(json).not.toContain("041 123 456");
    expect(json).not.toContain("u29c-wk-");
    expect([...keys].sort()).toEqual(
      [
        "bookingId",
        "customerName",
        "date",
        "displayName",
        "expired",
        "expiresDate",
        "expiresTime",
        "from",
        "futureBookings",
        "futureCount",
        "invite",
        "inviteId",
        "isMe",
        "memberId",
        "moreBookings",
        "noLogin",
        "role",
        "services",
        "status",
        "to",
      ].sort()
    );
    expect(Object.keys(answer).sort()).toEqual(["invites", "members"]);
    expect([...keysDeep(answer.invites)].sort()).toEqual(
      ["email", "expired", "expiresDate", "expiresTime", "inviteId", "name", "role"].sort()
    );
    const all = keysDeep(answer);
    for (const banned of [
      "token",
      "tokenHash",
      "createdByUserId",
      "uid",
      "phone",
      "userId",
      "user",
      "username",
    ]) {
      expect(all.has(banned)).toBe(false);
    }
    const whole = JSON.stringify(answer);
    expect(whole).not.toContain("a".repeat(64));
    expect(whole).not.toContain("b".repeat(64));
  });
});

// Flowko U29c: W4 (add a desk-only worker) and W5 (reorder). Locks and races: workers.integration-test.ts.
const businessOf = async (memberId: number): Promise<number> =>
  (await prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id: memberId } })).businessId;
const memberRows = async (businessId: number) =>
  (
    await prismock.flowkoBusinessMember.findMany({
      where: { businessId },
      select: { id: true, position: true, displayName: true },
    })
  )
    .sort((x, y) => x.position - y.position || x.id - y.id)
    .map((m) => [m.id, m.position]);

describe("addDeskWorker (W4 workers.addDeskOnly)", () => {
  it("adds an ACTIVE desk-only WORKER, last in the list, and answers its member id", async () => {
    const { memberId } = await addDeskWorker(db, f.users.olga, { displayName: "Maja" });

    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member).toMatchObject({
      businessId: f.a,
      role: FlowkoBusinessRole.WORKER,
      status: FlowkoMemberStatus.ACTIVE,
      displayName: "Maja",
      position: 7,
    });
    const user = await prismock.user.findUnique({ where: { id: member?.userId as number } });
    expect(user?.email.endsWith("@flowko.invalid")).toBe(true);
    // No usual week, no roster days, no services.
    expect(await prismock.flowkoRosterDay.count({ where: { memberId } })).toBe(0);
    expect(member?.usualWeek ?? null).toBeNull();
    expect(await prismock.flowkoServiceWorker.count({ where: { memberId } })).toBe(0);

    const { members } = await listWorkers(db, f.users.olga, NOW);
    const last = members[members.length - 1];
    expect([last.displayName, last.role, last.status, last.noLogin]).toEqual([
      "Maja",
      "WORKER",
      "ACTIVE",
      true,
    ]);
  });

  it("goes after the highest position, not after the count (members at 0 and 5 -> 6)", async () => {
    const solo = await makeUser("Solo");
    const created = await createBusiness(db, {
      ownerUserId: solo,
      name: "Salon C",
      slug: `salon-c-${seq}`,
      templateId: "hair-salon",
      phone: "01 000 00 00",
    });
    const second = await createDeskOnlyWorker(db, created.businessId, "Drugi");
    await prismock.flowkoBusinessMember.update({ where: { id: second.memberId }, data: { position: 5 } });
    const { memberId } = await addDeskWorker(db, solo, { displayName: "Maja" });
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member?.position).toBe(6);
  });

  it("trims the name; a name already used (trim + Slovene lower-case compare, any status or kind) is member_name_taken", async () => {
    for (const taken of ["Ana", "  ana ", "ANA", "Dan", "mojca", "SARA", "olga"]) {
      expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: taken }))).toBe(
        "member_name_taken"
      );
    }
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
    // The same name in another business is free.
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "Bea" }))).toBe("ok");
    await addDeskWorker(db, f.users.olga, { displayName: "  Maja  " });
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: " maja " }))).toBe(
      "member_name_taken"
    );
    const stored = await prismock.flowkoBusinessMember.findMany({ where: { displayName: "Maja" } });
    expect(stored).toHaveLength(1);
  });

  it("treats a decomposed and a composed spelling of the same name as one (NFC)", async () => {
    await addDeskWorker(db, f.users.olga, { displayName: "\u010Caja" }); // composed C-caron
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "C\u030Caja" }))).toBe(
      "member_name_taken"
    );
  });

  it("refuses an empty name and one of 81 characters as bad_member; 80 is fine", async () => {
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "" }))).toBe("bad_member");
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "   " }))).toBe("bad_member");
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "x".repeat(81) }))).toBe(
      "bad_member"
    );
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "y".repeat(80) }))).toBe("ok");
  });

  it("is the owner's: a worker, a staff member, a locked member and a stranger are forbidden, nothing written", async () => {
    const users = await prismock.user.count();
    for (const actor of [f.users.ana, f.users.rok, f.users.dan, await makeUser("Nobody")]) {
      expect(await outcome(addDeskWorker(db, actor, { displayName: "Maja" }))).toBe("forbidden");
    }
    expect(await prismock.user.count()).toBe(users + 1); // only "Nobody" itself
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
  });

  it("always writes into the actor's own business (the owner of B adds to B only)", async () => {
    const { memberId } = await addDeskWorker(db, f.users.zala, { displayName: "Maja" });
    const member = await prismock.flowkoBusinessMember.findUnique({ where: { id: memberId } });
    expect(member?.businessId).not.toBe(f.a);
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
  });

  it("answers a lost lock race (P2028, P2034, P2010 with 40P01 in both meta forms) as member_conflict", async () => {
    const raw = (code: string, meta: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: "6", meta });
    const failures = [
      raw("P2028", {}),
      raw("P2034", {}),
      raw("P2010", { code: "40P01", message: "deadlock detected" }),
      raw("P2010", {
        driverAdapterError: { cause: { originalCode: "40P01", kind: "postgres", code: "40P01" } },
      }),
    ];
    for (const failure of failures) {
      vi.spyOn(prismock.flowkoBusinessMember, "create").mockRejectedValueOnce(failure);
      expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "Maja" }))).toBe("member_conflict");
    }
    const other = raw("P2010", { code: "22P02" });
    vi.spyOn(prismock.flowkoBusinessMember, "create").mockRejectedValueOnce(other);
    await expect(addDeskWorker(db, f.users.olga, { displayName: "Maja" })).rejects.toBe(other);
  });
});

describe("reorderWorkers (W5 workers.reorder)", () => {
  const allIds = () => [
    f.members.olga,
    f.members.ana,
    f.members.bor,
    f.members.dan,
    f.members.mojca,
    f.members.rok,
    f.members.sara,
  ];

  it("writes position = index in the sent order over every member (OWNER, LOCKED, STAFF, desk-only), nothing else", async () => {
    const order = [
      f.members.sara,
      f.members.olga,
      f.members.dan,
      f.members.mojca,
      f.members.rok,
      f.members.bor,
      f.members.ana,
    ];
    expect(await reorderWorkers(db, f.users.olga, { memberIds: order })).toEqual({ status: "saved" });
    expect(await memberRows(f.a)).toEqual(order.map((id, index) => [id, index]));
    const { members } = await listWorkers(db, f.users.olga, NOW);
    expect(members.map((m) => m.memberId)).toEqual(order);
    // Business B is untouched.
    expect(await memberRows(await businessOf(f.members.zala))).toEqual([
      [f.members.zala, 0],
      [f.members.bea, 1],
    ]);
  });

  it("closes gaps: stored positions 0, 5, 9 ... become 0..n-1", async () => {
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.sara }, data: { position: 40 } });
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.ana }, data: { position: 17 } });
    const order = allIds();
    await reorderWorkers(db, f.users.olga, { memberIds: order });
    expect(await memberRows(f.a)).toEqual(order.map((id, index) => [id, index]));
  });

  it("refuses a missing, an extra, a duplicate and a foreign id as bad_member, nothing written", async () => {
    const before = await memberRows(f.a);
    const ids = allIds();
    const attempts = [
      ids.slice(1), // missing
      [...ids, 999_999], // extra (unknown)
      [...ids.slice(0, -1), ids[0]], // duplicate in place of the last
      [...ids, ids[0]], // duplicate on top
      [...ids.slice(0, -1), f.members.bea], // foreign member in place of one of ours
      [...ids, f.members.bea], // foreign member as well
      [], // empty
    ];
    for (const memberIds of attempts) {
      expect(await outcome(reorderWorkers(db, f.users.olga, { memberIds }))).toBe("bad_member");
      expect(await memberRows(f.a)).toEqual(before);
    }
    // Non-integers never reach the write.
    expect(await outcome(reorderWorkers(db, f.users.olga, { memberIds: [...ids.slice(1), 1.5] }))).toBe(
      "bad_member"
    );
    expect(await memberRows(f.a)).toEqual(before);
  });

  it("is the owner's: a worker, a staff member, a locked member and a stranger are forbidden, nothing written", async () => {
    const before = await memberRows(f.a);
    const reversed = allIds().reverse();
    for (const actor of [f.users.ana, f.users.rok, f.users.dan, await makeUser("Nobody")]) {
      expect(await outcome(reorderWorkers(db, actor, { memberIds: reversed }))).toBe("forbidden");
    }
    expect(await memberRows(f.a)).toEqual(before);
  });

  it("the owner of B cannot reorder A: B's own list is the only valid set", async () => {
    const before = await memberRows(f.a);
    expect(await outcome(reorderWorkers(db, f.users.zala, { memberIds: allIds() }))).toBe("bad_member");
    expect(await memberRows(f.a)).toEqual(before);
    expect(
      await outcome(reorderWorkers(db, f.users.zala, { memberIds: [f.members.bea, f.members.zala] }))
    ).toBe("ok");
  });

  it("answers a lost lock race (P2028, P2034, P2010 with 40P01 in both meta forms) as member_conflict", async () => {
    const raw = (code: string, meta: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: "6", meta });
    const failures = [
      raw("P2028", {}),
      raw("P2034", {}),
      raw("P2010", { code: "40P01", message: "deadlock detected" }),
      raw("P2010", {
        driverAdapterError: { cause: { originalCode: "40P01", kind: "postgres", code: "40P01" } },
      }),
    ];
    const reversed = allIds().reverse();
    for (const failure of failures) {
      vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(failure);
      expect(await outcome(reorderWorkers(db, f.users.olga, { memberIds: reversed }))).toBe(
        "member_conflict"
      );
    }
    const other = raw("P2010", { code: "22P02" });
    vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(other);
    await expect(reorderWorkers(db, f.users.olga, { memberIds: reversed })).rejects.toBe(other);
  });
});

describe("listWorkers moreBookings (Task 2 review carry)", () => {
  it("never goes negative when the list read finds more rows than the count read did", async () => {
    await bookingOn(f.members.dan, { start: at("2026-11-17", "10:00") });
    await bookingOn(f.members.dan, { start: at("2026-11-18", "10:00") });
    const real = prismock.booking.findMany.bind(prismock.booking);
    // The first read (the counts) sees only one booking; the second (the details) sees both.
    vi.spyOn(prismock.booking, "findMany").mockImplementationOnce((async (args: never) =>
      (await real(args)).slice(0, 1)) as never);
    const { members } = await listWorkers(db, f.users.olga, NOW);
    const dan = members.find((m) => m.displayName === "Dan");
    expect(dan?.futureCount).toBe(1);
    expect(dan?.futureBookings).toHaveLength(2);
    expect(dan?.moreBookings).toBe(0);
  });
});
