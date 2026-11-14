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
// Flowko U29e: the rename reads (desk member list, Urnik) to prove the new name shows everywhere.
import { listDeskMembers } from "./desk";
// Flowko U29e (E5): readUsualWeek reads the copied week back.
import { getRosterWeek, readUsualWeek } from "./roster";
import { addDeskWorker, listWorkers, renameMember, reorderWorkers } from "./workers";

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
    // Flowko U29e (E5, R3): a third top-level key, the owner's usual week as a boolean (never the week itself).
    expect(Object.keys(answer).sort()).toEqual(["invites", "members", "ownerUsualWeek"]);
    expect(typeof answer.ownerUsualWeek).toBe("boolean");
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
    // Flowko U29e (E5): the fixture owner Olga has no usual week, so none is copied; no roster days, no services
    // (C10). The copy itself: the "addDeskWorker copies the owner's usual week" block below.
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

  // Flowko U29e (RIGHTS-1, R5): control, bidi, separator and invisible characters, and names with nothing visible.
  it("refuses a name with a control, bidi, separator or invisible character as bad_member, nothing written", async () => {
    const users = await prismock.user.count();
    for (const displayName of [
      "A\u0000",
      "A\u0085",
      "Ana\u200B",
      "An\u2060a",
      "Ana\u202E",
      "Ana\u2066x",
      "Ana\u061C",
      "An\u2028a",
      "\u200D",
      "\u00AD",
    ]) {
      expect(await outcome(addDeskWorker(db, f.users.olga, { displayName }))).toBe("bad_member");
    }
    expect(await prismock.user.count()).toBe(users);
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
  });

  it("a look-alike with a joiner or a soft hyphen is member_name_taken; an emoji name with ZWJ is fine", async () => {
    for (const displayName of ["Ana\u200D", "A\u200Cna", "A\u00ADna", "\u200D ana"]) {
      expect(await outcome(addDeskWorker(db, f.users.olga, { displayName }))).toBe("member_name_taken");
    }
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
    const family = "Maja \uD83D\uDC69\u200D\uD83D\uDC67";
    const { memberId } = await addDeskWorker(db, f.users.olga, { displayName: family });
    const member = await prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id: memberId } });
    expect(member.displayName).toBe(family);
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

// Flowko U29e (E5, R1, R3): „Dodaj brez prijave“ gives the new worker the owner's usual week (the accept's predicate,
// usualWeekForCopy), answers whether it did, and workers.list says whether the owner has one. Services stay empty
// (C10). The race with the owner's usual-week save: workers.integration-test.ts.
describe("addDeskWorker copies the owner's usual week (U29e E5)", () => {
  const e = (from: string, to: string) => ({ from, to });
  const OWNER_WEEK = {
    mon: [e("08:00", "12:00"), e("13:00", "16:00")],
    tue: [e("08:00", "16:00")],
    wed: [],
    thu: [e("09:00", "17:00")],
    fri: [e("08:00", "14:00")],
    sat: [],
    sun: [],
  };
  const LATER_WEEK = { ...OWNER_WEEK, sat: [e("09:00", "13:00")] };
  const EMPTY_WEEK = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const TOO_MANY = {
    ...OWNER_WEEK,
    tue: [
      e("06:00", "07:00"),
      e("08:00", "09:00"),
      e("10:00", "11:00"),
      e("12:00", "13:00"),
      e("14:00", "15:00"),
    ],
  };
  const setWeek = (memberId: number, usualWeek: unknown) =>
    prismock.flowkoBusinessMember.update({
      where: { id: memberId },
      data: { usualWeek: usualWeek as never },
    });
  const weekOf = async (memberId: number) =>
    readUsualWeek(
      (await prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id: memberId } })).usualWeek
    );

  it("the owner has a valid week: the new member gets exactly it, answer copied; still no services, no roster days", async () => {
    await setWeek(f.members.olga, OWNER_WEEK);
    const answer = await addDeskWorker(db, f.users.olga, { displayName: "Maja" });
    expect(answer).toEqual({ status: "added", memberId: expect.any(Number), usualWeek: "copied" });
    expect(Object.keys(answer).sort()).toEqual(["memberId", "status", "usualWeek"]);
    expect(await weekOf(answer.memberId)).toEqual(OWNER_WEEK);
    expect(await prismock.flowkoServiceWorker.count({ where: { memberId: answer.memberId } })).toBe(0);
    expect(await prismock.flowkoRosterDay.count({ where: { memberId: answer.memberId } })).toBe(0);
    // The owner's own week is untouched.
    expect(await weekOf(f.members.olga)).toEqual(OWNER_WEEK);
  });

  it("the owner has none, Prisma.DbNull, more than 4 shifts a day, an all-empty week or a bad shape: no week, answer none", async () => {
    const variants: Array<[string, unknown]> = [
      ["never set", undefined],
      ["DbNull", Prisma.DbNull],
      ["too many shifts", TOO_MANY],
      ["all empty", EMPTY_WEEK],
      ["bad shape", { mon: "08:00-16:00" }],
    ];
    for (const [label, week] of variants) {
      if (week !== undefined) await setWeek(f.members.olga, week);
      const answer = await addDeskWorker(db, f.users.olga, { displayName: `Nova ${label}` });
      expect([label, answer]).toEqual([
        label,
        { status: "added", memberId: answer.memberId, usualWeek: "none" },
      ]);
      expect([label, await weekOf(answer.memberId)]).toEqual([label, null]);
    }
  });

  it("copies the week as stored at the add: a later week is copied, a cleared one gives none; earlier copies stay", async () => {
    await setWeek(f.members.olga, OWNER_WEEK);
    const first = await addDeskWorker(db, f.users.olga, { displayName: "Prva" });
    await setWeek(f.members.olga, LATER_WEEK);
    const second = await addDeskWorker(db, f.users.olga, { displayName: "Druga" });
    await setWeek(f.members.olga, Prisma.DbNull);
    const third = await addDeskWorker(db, f.users.olga, { displayName: "Tretja" });
    expect([first.usualWeek, second.usualWeek, third.usualWeek]).toEqual(["copied", "copied", "none"]);
    expect(await weekOf(first.memberId)).toEqual(OWNER_WEEK);
    expect(await weekOf(second.memberId)).toEqual(LATER_WEEK);
    expect(await weekOf(third.memberId)).toBeNull();
  });

  it("only the actor's own owner counts: B's owner week never reaches A, and a worker's week is not the owner's", async () => {
    await setWeek(f.members.zala, LATER_WEEK);
    await setWeek(f.members.ana, OWNER_WEEK);
    const inA = await addDeskWorker(db, f.users.olga, { displayName: "Maja" });
    expect(inA.usualWeek).toBe("none");
    expect(await weekOf(inA.memberId)).toBeNull();

    await setWeek(f.members.olga, OWNER_WEEK);
    const inAAgain = await addDeskWorker(db, f.users.olga, { displayName: "Maja Druga" });
    const inB = await addDeskWorker(db, f.users.zala, { displayName: "Maja" });
    expect(await weekOf(inAAgain.memberId)).toEqual(OWNER_WEEK);
    expect(await weekOf(inB.memberId)).toEqual(LATER_WEEK);
  });

  it("createDeskOnlyWorker without opts (the set-up script's 3-argument call) and staff never get a week", async () => {
    await setWeek(f.members.olga, OWNER_WEEK);
    const script = await createDeskOnlyWorker(db, f.a, "Skripta");
    const noKey = await createDeskOnlyWorker(db, f.a, "Brez", {});
    const nullWeek = await createDeskOnlyWorker(db, f.a, "Nic", { usualWeek: null });
    const given = await createDeskOnlyWorker(db, f.a, "Dana", { usualWeek: LATER_WEEK });
    const staff = await addStaffWithoutLogin(db, f.a, "Recepcija");
    expect(await weekOf(script.memberId)).toBeNull();
    expect(await weekOf(noKey.memberId)).toBeNull();
    expect(await weekOf(nullWeek.memberId)).toBeNull();
    expect(await weekOf(given.memberId)).toEqual(LATER_WEEK);
    expect(await weekOf((staff as { memberId: number }).memberId)).toBeNull();
  });

  it("refusals copy nothing: forbidden and member_name_taken write no member", async () => {
    await setWeek(f.members.olga, OWNER_WEEK);
    expect(await outcome(addDeskWorker(db, f.users.ana, { displayName: "Maja" }))).toBe("forbidden");
    expect(await outcome(addDeskWorker(db, f.users.olga, { displayName: "ana" }))).toBe("member_name_taken");
    expect(await prismock.flowkoBusinessMember.count({ where: { businessId: f.a } })).toBe(7);
  });

  it("workers.list answers ownerUsualWeek by the same predicate as the copy", async () => {
    const flag = async () => (await listWorkers(db, f.users.olga, NOW)).ownerUsualWeek;
    expect(await flag()).toBe(false); // never set
    // A worker's week and another business's owner week do not count.
    await setWeek(f.members.ana, OWNER_WEEK);
    await setWeek(f.members.zala, OWNER_WEEK);
    expect(await flag()).toBe(false);
    await setWeek(f.members.olga, OWNER_WEEK);
    expect(await flag()).toBe(true);
    for (const week of [Prisma.DbNull, TOO_MANY, EMPTY_WEEK, { mon: "08:00-16:00" }]) {
      await setWeek(f.members.olga, week);
      expect(await flag()).toBe(false);
    }
    await setWeek(f.members.olga, LATER_WEEK);
    expect(await flag()).toBe(true);
    expect((await listWorkers(db, f.users.zala, NOW)).ownerUsualWeek).toBe(true);
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

// Flowko U29e (E9, R6-R8): the owner renames a member. Locks and races: workers.integration-test.ts.
describe("renameMember (E9 workers.rename)", () => {
  const userIdOf = async (memberId: number): Promise<number> =>
    (await prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id: memberId } })).userId as number;
  const memberRow = (id: number) => prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id } });
  const userRow = (id: number) => prismock.user.findUniqueOrThrow({ where: { id } });
  /** Every member row and every user row, whole (prismock writes no updatedAt, so equal rows = nothing written). */
  const everything = async () => ({
    members: await prismock.flowkoBusinessMember.findMany({ orderBy: { id: "asc" } }),
    users: await prismock.user.findMany({ orderBy: { id: "asc" } }),
  });
  /** Spies on the two writes a rename may make; restored by the caller. */
  function spyWrites() {
    const member = vi.spyOn(prismock.flowkoBusinessMember, "update");
    const user = vi.spyOn(prismock.user, "update");
    member.mockClear();
    user.mockClear();
    return {
      member,
      user,
      restore: () => {
        member.mockRestore();
        user.mockRestore();
      },
    };
  }

  it("a desk-only worker: displayName and User.name both change, the e-mail stays; answers saved", async () => {
    const userId = await userIdOf(f.members.mojca);
    const before = await userRow(userId);
    expect(before.name).toBe("Mojca");
    expect(
      await renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "  Mojca Nova  " })
    ).toEqual({ status: "saved" });
    expect((await memberRow(f.members.mojca)).displayName).toBe("Mojca Nova");
    const after = await userRow(userId);
    expect(after).toEqual({ ...before, name: "Mojca Nova" });
    expect(after.email).toBe(before.email);
    expect(after.email.endsWith("@flowko.invalid")).toBe(true);
  });

  it("a login worker, a login staff member and the owner's own row: only displayName, the user row is untouched", async () => {
    for (const [memberId, userId, next] of [
      [f.members.ana, f.users.ana, "Ana Kovač"],
      [f.members.rok, f.users.rok, "Rok Recepcija"],
      [f.members.olga, f.users.olga, "Olga Lastnica"],
    ] as const) {
      const before = await userRow(userId);
      expect(await renameMember(db, f.users.olga, { memberId, displayName: next })).toEqual({
        status: "saved",
      });
      expect((await memberRow(memberId)).displayName).toBe(next);
      expect(await userRow(userId)).toEqual(before);
    }
  });

  it("a converted member (desk user that now has a real e-mail): only displayName, User.name stays the person's", async () => {
    const userId = await userIdOf(f.members.mojca);
    await prismock.user.update({
      where: { id: userId },
      data: { email: "mojca.prava@example.com", name: "Mojca Vpisana" },
    });
    const before = await userRow(userId);
    await renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "Mojca S." });
    expect((await memberRow(f.members.mojca)).displayName).toBe("Mojca S.");
    expect(await userRow(userId)).toEqual(before);
  });

  it("staff without a login: displayName only, no user write", async () => {
    const writes = spyWrites();
    try {
      await renameMember(db, f.users.olga, { memberId: f.members.sara, displayName: "Sara Blagajna" });
      expect(writes.user).not.toHaveBeenCalled();
      expect(writes.member).toHaveBeenCalledTimes(1);
    } finally {
      writes.restore();
    }
    expect((await memberRow(f.members.sara)).displayName).toBe("Sara Blagajna");
  });

  it("a LOCKED member can be renamed (status kept)", async () => {
    const before = await userRow(f.users.dan);
    await renameMember(db, f.users.olga, { memberId: f.members.dan, displayName: "Dan Stari" });
    expect(await memberRow(f.members.dan)).toMatchObject({
      displayName: "Dan Stari",
      status: FlowkoMemberStatus.LOCKED,
    });
    expect(await userRow(f.users.dan)).toEqual(before);
  });

  it("a case-only change of one's own name passes (self is not a duplicate), the owner's and another member's", async () => {
    await renameMember(db, f.users.olga, { memberId: f.members.olga, displayName: "OLGA" });
    expect((await memberRow(f.members.olga)).displayName).toBe("OLGA");
    await renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "mojca" });
    expect((await memberRow(f.members.mojca)).displayName).toBe("mojca");
    expect((await userRow(await userIdOf(f.members.mojca))).name).toBe("mojca");
  });

  it("an unchanged name (after trim) answers saved and writes nothing", async () => {
    const before = await everything();
    const writes = spyWrites();
    try {
      for (const displayName of ["Mojca", "  Mojca "]) {
        expect(await renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName })).toEqual({
          status: "saved",
        });
      }
      expect(writes.member).not.toHaveBeenCalled();
      expect(writes.user).not.toHaveBeenCalled();
    } finally {
      writes.restore();
    }
    expect(await everything()).toEqual(before);
  });

  it("another member's name in any case, NFC or invisible-character variant is member_name_taken, nothing written", async () => {
    await renameMember(db, f.users.olga, { memberId: f.members.sara, displayName: "\u010Caja" }); // composed
    const before = await everything();
    for (const displayName of [
      "Ana",
      " ana ",
      "ANA",
      "Dan", // LOCKED
      "C\u030Caja", // decomposed C-caron against the composed one
      "Ana\u200D",
      "A\u00ADna",
      "olga",
      "ROK",
    ]) {
      expect(await outcome(renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName }))).toBe(
        "member_name_taken"
      );
    }
    expect(await everything()).toEqual(before);
    // A name used only in another business is free; so is a name freed by an earlier rename.
    expect(
      await outcome(renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "Bea" }))
    ).toBe("ok");
    expect(
      await outcome(renameMember(db, f.users.olga, { memberId: f.members.ana, displayName: "Sara" }))
    ).toBe("ok");
  });

  it("an empty name, 81 characters and a refused character are bad_member, nothing written", async () => {
    const before = await everything();
    for (const displayName of ["", "   ", "x".repeat(81), "A\u0000", "Ana\u200B", "Ana\u202E", "\u200D"]) {
      expect(await outcome(renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName }))).toBe(
        "bad_member"
      );
    }
    expect(await everything()).toEqual(before);
    expect(
      await outcome(
        renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "y".repeat(80) })
      )
    ).toBe("ok");
  });

  it("is the owner's: a worker, a staff member, a locked member, a stranger, a foreign owner and a missing id are forbidden, nothing written", async () => {
    const before = await everything();
    const writes = spyWrites();
    try {
      for (const actor of [f.users.ana, f.users.rok, f.users.dan, f.users.zala]) {
        expect(
          await outcome(renameMember(db, actor, { memberId: f.members.mojca, displayName: "Nova" }))
        ).toBe("forbidden");
      }
      // The owner of A cannot reach B's member; a missing id answers the same.
      for (const memberId of [f.members.bea, f.members.zala, 999_999]) {
        expect(await outcome(renameMember(db, f.users.olga, { memberId, displayName: "Nova" }))).toBe(
          "forbidden"
        );
      }
      // A worker cannot rename herself either.
      expect(
        await outcome(renameMember(db, f.users.ana, { memberId: f.members.ana, displayName: "Ana Nova" }))
      ).toBe("forbidden");
      expect(writes.member).not.toHaveBeenCalled();
      expect(writes.user).not.toHaveBeenCalled();
    } finally {
      writes.restore();
    }
    expect(await everything()).toEqual(before);
    const stranger = await makeUser("Nobody");
    expect(
      await outcome(renameMember(db, stranger, { memberId: f.members.mojca, displayName: "Nova" }))
    ).toBe("forbidden");
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
      vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(failure);
      expect(
        await outcome(renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "Nova" }))
      ).toBe("member_conflict");
    }
    const other = raw("P2010", { code: "22P02" });
    vi.spyOn(prismock.flowkoBusinessMember, "update").mockRejectedValueOnce(other);
    await expect(
      renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "Nova" })
    ).rejects.toBe(other);
  });

  it("afterwards Delavci, the desk's member list and Urnik show the new name", async () => {
    await renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "Mojca Nova" });
    const { members } = await listWorkers(db, f.users.olga, NOW);
    expect(members.find((m) => m.memberId === f.members.mojca)?.displayName).toBe("Mojca Nova");
    const desk = await listDeskMembers(db, f.users.ana);
    expect(desk.find((m) => m.memberId === f.members.mojca)?.displayName).toBe("Mojca Nova");
    const roster = await getRosterWeek(db, f.users.olga, "2026-11-16", NOW);
    expect(roster.members.find((m) => m.memberId === f.members.mojca)?.displayName).toBe("Mojca Nova");
    expect(JSON.stringify([members, desk, roster])).not.toContain('"Mojca"');
  });

  it("an open member invite keeps the name it was sent with (R6)", async () => {
    const invite = await prismock.flowkoBusinessInvite.create({
      data: {
        businessId: f.a,
        email: "mojca@example.com",
        name: "Mojca",
        role: FlowkoBusinessRole.WORKER,
        memberId: f.members.mojca,
        tokenHash: "c".repeat(64),
        expiresAt: new Date(NOW.getTime() + 86_400_000),
        createdByUserId: f.users.olga,
      },
    });
    await renameMember(db, f.users.olga, { memberId: f.members.mojca, displayName: "Mojca Nova" });
    expect(await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(
      invite
    );
  });
});
