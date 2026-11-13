// @vitest-environment node
// Flowko U29c: the owner's „Delavci“ list (listWorkers, W1) on a real database with real business bookings
// written by the U27 writer. Proves Review Focus 1 (privacy): Dan (LOCKED) has three real bookings, one of them
// cancelled afterwards, plus a private Cal booking of his own on his own event type and a Cal booking from before
// he joined (no mirror) -> only the two live mirror bookings count and are listed, with local date and time,
// distinct services in step order and the first attendee; Ana (ACTIVE) shows a count and no list; another
// business's booking never shows; a non-owner is forbidden; the answer holds no uid, e-mail, phone or user id.
// Runs only with VITEST_MODE=integration against the throwaway DB.

import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import { FlowkoBusinessError } from "./errors";
import { setMemberLock } from "./lock";
import { setUsualWeek } from "./roster";
import { addDeskWorker, listWorkers, reorderWorkers } from "./workers";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const TUE = "2026-11-17";
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const quiet: WriterDeps = { googleBusy: async () => ({ busy: [], unavailable: false }), sendMails: false };
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
  olga: number;
  zala: number;
  ana: number;
  members: { olga: number; ana: number; dan: number; mojca: number; bea: number };
  mens: number;
  feniranje: number;
  ids: { danKept: number; danTwoServices: number; danCancelled: number; ana: number; bea: number };
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

async function book(
  actor: number,
  memberId: number,
  serviceIds: number[],
  start: Date,
  customerName: string
): Promise<number> {
  const input: CreateBookingInput = {
    workerMemberId: memberId,
    serviceIds,
    start,
    customer: {
      name: customerName,
      phone: "041 123 456",
      email: `${customerName.replace(/\s/g, ".")}-${RUN}@example.com`,
    },
    confirmOverride: false,
  };
  const result = await createBusinessBooking(prisma, actor, input, NOW, quiet);
  if (result.status !== "created")
    throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  return result.bookingId;
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

beforeAll(async () => {
  const olga = await realUser("Olga");
  const { businessId, ownerMemberId, serviceIds } = await createBusiness(prisma, {
    ownerUserId: olga,
    name: `Salon Delavci ${RUN}`,
    slug: `salon-delavci-${RUN}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
  });
  await prisma.flowkoBusiness.update({ where: { id: businessId }, data: { openHolidays: [] } });
  const anaUser = await realUser("Ana");
  const danUser = await realUser("Dan");
  const ana = await addLoginMember(prisma, businessId, anaUser, FlowkoBusinessRole.WORKER);
  const dan = await addLoginMember(prisma, businessId, danUser, FlowkoBusinessRole.WORKER);
  const mojca = await createDeskOnlyWorker(prisma, businessId, "Mojca");
  const mens = serviceIds[0]; // "Moško striženje"
  const feniranje = serviceIds[5];
  await prisma.flowkoServiceWorker.createMany({
    data: [ana.memberId, dan.memberId].flatMap((memberId) => [
      { serviceId: mens, memberId },
      { serviceId: feniranje, memberId },
    ]),
  });
  for (const memberId of [ana.memberId, dan.memberId]) {
    await setUsualWeek(prisma, olga, {
      memberId,
      usualWeek: week([{ from: "08:00", to: "16:00" }]),
      confirmOutsideOpening: false,
    });
  }

  // Dan's real business bookings (the owner books for him), then one of them is cancelled.
  const danKept = await book(olga, dan.memberId, [mens], at(TUE, "09:00"), "Marija Novak");
  const danTwoServices = await book(olga, dan.memberId, [mens, feniranje], at(TUE, "10:00"), "Eva Zupan");
  const danCancelled = await book(olga, dan.memberId, [mens], at(TUE, "13:00"), "Ivan Horvat");
  await prisma.booking.update({ where: { id: danCancelled }, data: { status: BookingStatus.CANCELLED } });
  const anaBooking = await book(olga, ana.memberId, [mens], at(TUE, "09:00"), "Nina Kos");

  // Dan's own Cal bookings: one on his private event type, one from before he joined (no mirror). Neither may show.
  const ownType = await prisma.eventType.create({
    data: { title: "Private", slug: `private-dan-${RUN}`, length: 30, userId: danUser },
    select: { id: true },
  });
  for (const [eventTypeId, uid, createdAt, time] of [
    [ownType.id, `u29c-private-${RUN}`, new Date(), "10:00"],
    [null, `u29c-prejoin-${RUN}`, new Date("2020-01-01T00:00:00Z"), "12:00"],
  ] as const) {
    await prisma.booking.create({
      data: {
        uid,
        title: "Private",
        startTime: at("2026-11-18", time),
        endTime: new Date(at("2026-11-18", time).getTime() + 3_600_000),
        userId: danUser,
        eventTypeId,
        status: BookingStatus.ACCEPTED,
        createdAt,
        attendees: { create: { name: "Secret Person", email: `secret-${RUN}@example.com`, timeZone: TZ } },
      },
    });
  }
  await setMemberLock(prisma, dan.memberId, true, NOW);

  // Another business with a booking of its own.
  const zala = await realUser("Zala");
  const other = await createBusiness(prisma, {
    ownerUserId: zala,
    name: `Salon B ${RUN}`,
    slug: `salon-b-${RUN}`,
    templateId: "hair-salon",
  });
  await prisma.flowkoBusiness.update({ where: { id: other.businessId }, data: { openHolidays: [] } });
  const bea = await addLoginMember(
    prisma,
    other.businessId,
    await realUser("Bea"),
    FlowkoBusinessRole.WORKER
  );
  await prisma.flowkoServiceWorker.create({
    data: { serviceId: other.serviceIds[0], memberId: bea.memberId },
  });
  await setUsualWeek(prisma, zala, {
    memberId: bea.memberId,
    usualWeek: week([{ from: "08:00", to: "16:00" }]),
    confirmOutsideOpening: false,
  });
  const beaBooking = await book(zala, bea.memberId, [other.serviceIds[0]], at(TUE, "09:00"), "Bea Kunde");

  fx = {
    olga,
    zala,
    ana: anaUser,
    members: {
      olga: ownerMemberId,
      ana: ana.memberId,
      dan: dan.memberId,
      mojca: mojca.memberId,
      bea: bea.memberId,
    },
    mens,
    feniranje,
    ids: { danKept, danTwoServices, danCancelled, ana: anaBooking, bea: beaBooking },
  };
});

describe("U29c listWorkers on a real database", () => {
  it("Review Focus 1: Dan's two live mirror bookings are counted and listed; private, pre-join, cancelled and foreign ones are not", async () => {
    const { members } = await listWorkers(prisma, fx.olga, NOW);
    expect(members.map((m) => [m.displayName, m.role, m.status, m.futureCount])).toEqual([
      ["Olga", "OWNER", "ACTIVE", 0],
      ["Ana", "WORKER", "ACTIVE", 1],
      ["Dan", "WORKER", "LOCKED", 2],
      ["Mojca", "WORKER", "ACTIVE", 0],
    ]);
    const dan = members.find((m) => m.memberId === fx.members.dan);
    expect(dan?.futureBookings).toEqual([
      {
        bookingId: fx.ids.danKept,
        date: TUE,
        from: "09:00",
        to: "09:30",
        services: ["Moško striženje"],
        customerName: "Marija Novak",
      },
      {
        bookingId: fx.ids.danTwoServices,
        date: TUE,
        from: "10:00",
        to: "11:00",
        services: ["Moško striženje", "Feniranje"],
        customerName: "Eva Zupan",
      },
    ]);
    expect(dan?.moreBookings).toBe(0);
    expect(members.find((m) => m.memberId === fx.members.ana)?.futureBookings).toEqual([]);
    expect(members.find((m) => m.memberId === fx.members.mojca)).toMatchObject({
      noLogin: true,
      isMe: false,
    });
    expect(members.find((m) => m.memberId === fx.members.olga)).toMatchObject({ isMe: true, noLogin: false });
  });

  // Flowko U29d: the scan runs on the member rows (a pending brand-new invite carries the e-mail the owner typed);
  // Mojca's open invite adds only its expiry keys. The pending invites have their own exact key set.
  it("Review Focus 1: no uid, e-mail, phone or user id in the answer; the private booking's person never appears", async () => {
    const { businessId } = await prisma.flowkoBusinessMember.findUniqueOrThrow({
      where: { id: fx.members.olga },
      select: { businessId: true },
    });
    const hashes = ["a".repeat(64), "b".repeat(64)];
    const inviteIds: number[] = [];
    for (const [memberId, email, name, tokenHash] of [
      [fx.members.mojca, `mojca-${RUN}@example.com`, "Mojca", hashes[0]],
      [null, `hana-${RUN}@example.com`, "Hana", hashes[1]],
    ] as const) {
      const row = await prisma.flowkoBusinessInvite.create({
        data: {
          businessId,
          email,
          name,
          role: FlowkoBusinessRole.WORKER,
          memberId,
          tokenHash,
          expiresAt: new Date(NOW.getTime() + 86_400_000),
          createdByUserId: fx.olga,
        },
        select: { id: true },
      });
      inviteIds.push(row.id);
    }
    try {
      const answer = await listWorkers(prisma, fx.olga, NOW);
      const keys = keysDeep(answer.members);
      for (const banned of ["uid", "email", "phone", "phoneNumber", "userId", "user", "username"]) {
        expect(keys.has(banned)).toBe(false);
      }
      const json = JSON.stringify(answer.members);
      expect(json).not.toContain("@");
      expect(json).not.toContain("041 123 456");
      expect(json).not.toContain("Secret Person");
      expect(json).not.toContain(RUN);
      expect(answer.members.find((m) => m.memberId === fx.members.mojca)?.invite).toMatchObject({
        inviteId: inviteIds[0],
        expired: false,
      });
      expect(Array.from(keysDeep(answer.invites)).sort()).toEqual(
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
      for (const hash of hashes) expect(whole).not.toContain(hash);
      expect(whole).not.toContain("Secret Person");
    } finally {
      await prisma.flowkoBusinessInvite.deleteMany({ where: { id: { in: inviteIds } } });
    }
  });

  it("another business sees its own members and bookings only", async () => {
    const { members } = await listWorkers(prisma, fx.zala, NOW);
    expect(members.map((m) => [m.displayName, m.futureCount])).toEqual([
      ["Zala", 0],
      ["Bea", 1],
    ]);
  });

  it("a worker (and a locked worker) is forbidden", async () => {
    expect(await codeOf(listWorkers(prisma, fx.ana, NOW))).toBe("forbidden");
    expect(await codeOf(listWorkers(prisma, fx.olga + 999_999, NOW))).toBe("forbidden");
  });
});

// Flowko U29c Task 3: W4 / W5 and the locked, gap-proof nextPosition on a real database (Review Focus 5). Each test
// builds its own business, so the list assertions above stay exact.
async function freshBusiness(
  label: string
): Promise<{ owner: number; businessId: number; ownerMemberId: number }> {
  const owner = await realUser(`Own${label}`);
  const created = await createBusiness(prisma, {
    ownerUserId: owner,
    name: `Salon ${label} ${RUN}`,
    slug: `salon-${label.toLowerCase()}-${RUN}`,
    templateId: "hair-salon",
  });
  return { owner, businessId: created.businessId, ownerMemberId: created.ownerMemberId };
}

const positionsOf = async (businessId: number): Promise<Array<[number, number]>> =>
  (
    await prisma.flowkoBusinessMember.findMany({
      where: { businessId },
      select: { id: true, position: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    })
  ).map((m) => [m.id, m.position]);

describe("U29c addDeskWorker / reorderWorkers / nextPosition on a real database", () => {
  it("Review Focus 5: members at 0 and 5 -> the new desk-only worker is 6, ACTIVE WORKER on a desk address", async () => {
    const { owner, businessId } = await freshBusiness("Gap");
    const second = await createDeskOnlyWorker(prisma, businessId, "Drugi");
    await prisma.flowkoBusinessMember.update({ where: { id: second.memberId }, data: { position: 5 } });
    const { memberId } = await addDeskWorker(prisma, owner, { displayName: "Maja" });
    const member = await prisma.flowkoBusinessMember.findUniqueOrThrow({
      where: { id: memberId },
      include: { user: { select: { email: true, username: true, locked: true } } },
    });
    expect(member).toMatchObject({ position: 6, role: "WORKER", status: "ACTIVE", displayName: "Maja" });
    expect(member.user?.email.endsWith("@flowko.invalid")).toBe(true);
    expect(member.user?.username).toBeNull();
    // Another business's and a plain worker's actor: forbidden, nothing written.
    expect(await codeOf(addDeskWorker(prisma, fx.zala + 999_999, { displayName: "Nova" }))).toBe("forbidden");
    expect(await codeOf(addDeskWorker(prisma, fx.ana, { displayName: "Nova" }))).toBe("forbidden");
    expect(await prisma.flowkoBusinessMember.count({ where: { businessId } })).toBe(3);
  });

  it("Review Focus 5: parallel addDeskWorker x2 -> positions n and n+1 (10 rounds)", async () => {
    const { owner, businessId } = await freshBusiness("Par");
    for (let round = 0; round < 10; round++) {
      const before = await prisma.flowkoBusinessMember.count({ where: { businessId } });
      const [a, b] = await Promise.all([
        addDeskWorker(prisma, owner, { displayName: `A${round}` }),
        addDeskWorker(prisma, owner, { displayName: `B${round}` }),
      ]);
      const rows = await prisma.flowkoBusinessMember.findMany({
        where: { id: { in: [a.memberId, b.memberId] } },
        select: { position: true },
      });
      expect(rows.map((r) => r.position).sort((x, y) => x - y)).toEqual([before, before + 1]);
    }
    const all = await positionsOf(businessId);
    expect(all.map(([, position]) => position)).toEqual(all.map((_, index) => index));
  });

  it("every creator is serialised: parallel addDeskWorker + addStaffWithoutLogin + addLoginMember never share a position", async () => {
    const { owner, businessId } = await freshBusiness("Mix");
    for (let round = 0; round < 8; round++) {
      const login = await realUser(`Mix${round}`);
      await Promise.all([
        addDeskWorker(prisma, owner, { displayName: `Desk${round}` }),
        addStaffWithoutLogin(prisma, businessId, `Staff${round}`),
        addLoginMember(prisma, businessId, login, FlowkoBusinessRole.WORKER),
      ]);
    }
    const all = await positionsOf(businessId);
    expect(all).toHaveLength(1 + 8 * 3);
    expect(all.map(([, position]) => position)).toEqual(all.map((_, index) => index));
  });

  it("parallel „Maja“ + „maja“ -> exactly one member_name_taken (10 rounds, fresh pair each round)", async () => {
    const { owner, businessId } = await freshBusiness("Dup");
    for (let round = 0; round < 10; round++) {
      const codes = await Promise.all([
        codeOf(addDeskWorker(prisma, owner, { displayName: `Maja${round}` })),
        codeOf(addDeskWorker(prisma, owner, { displayName: ` maja${round} ` })),
      ]);
      expect(codes.sort()).toEqual(["member_name_taken", "ok"]);
      const same = await prisma.flowkoBusinessMember.findMany({
        where: { businessId, displayName: { in: [`Maja${round}`, `maja${round}`] } },
      });
      expect(same).toHaveLength(1);
    }
  });

  it("the same name in another business is free; a locked member's name is taken", async () => {
    const one = await freshBusiness("NameOne");
    const two = await freshBusiness("NameTwo");
    const worker = await createDeskOnlyWorker(prisma, one.businessId, "Lara");
    await setMemberLock(prisma, worker.memberId, true, NOW);
    expect(await codeOf(addDeskWorker(prisma, one.owner, { displayName: "lara" }))).toBe("member_name_taken");
    expect(await codeOf(addDeskWorker(prisma, two.owner, { displayName: "lara" }))).toBe("ok");
  });

  // Flowko U29e (RIGHTS-1, R5): NUL used to reach Postgres (0x00 is refused in text -> a raw driver error / 500).
  it("RIGHTS-1 on Postgres: a NUL or a C1 character in the name is bad_member, never a driver error; nothing written", async () => {
    const { owner, businessId } = await freshBusiness("Nul");
    const membersBefore = await prisma.flowkoBusinessMember.count({ where: { businessId } });
    const usersBefore = await prisma.user.count();
    for (const displayName of ["A\u0000", "\u0000", "A\u0085"]) {
      expect(await codeOf(addDeskWorker(prisma, owner, { displayName }))).toBe("bad_member");
    }
    expect(await prisma.flowkoBusinessMember.count({ where: { businessId } })).toBe(membersBefore);
    expect(await prisma.user.count()).toBe(usersBefore);
  });

  it("reorder writes 0..n-1 in the sent order over every member and closes gaps; the other business is untouched", async () => {
    const one = await freshBusiness("Ord");
    const other = await freshBusiness("OrdOther");
    const a = await addDeskWorker(prisma, one.owner, { displayName: "A" });
    const b = await addDeskWorker(prisma, one.owner, { displayName: "B" });
    const staff = await addStaffWithoutLogin(prisma, one.businessId, "S");
    await prisma.flowkoBusinessMember.update({ where: { id: b.memberId }, data: { position: 30 } });
    const otherBefore = await positionsOf(other.businessId);
    const order = [staff.memberId, one.ownerMemberId, b.memberId, a.memberId];
    expect(await reorderWorkers(prisma, one.owner, { memberIds: order })).toEqual({ status: "saved" });
    expect(await positionsOf(one.businessId)).toEqual(order.map((id, index) => [id, index]));
    expect(await positionsOf(other.businessId)).toEqual(otherBefore);
  });

  it("Review Focus 5: a stale list (a member was added meanwhile) is bad_member and nothing is written; foreign ids too", async () => {
    const one = await freshBusiness("Stale");
    const a = await addDeskWorker(prisma, one.owner, { displayName: "A" });
    const staleOrder = [a.memberId, one.ownerMemberId];
    await addDeskWorker(prisma, one.owner, { displayName: "B" });
    const before = await positionsOf(one.businessId);
    expect(await codeOf(reorderWorkers(prisma, one.owner, { memberIds: staleOrder }))).toBe("bad_member");
    expect(
      await codeOf(
        reorderWorkers(prisma, one.owner, { memberIds: [...before.map(([id]) => id), fx.members.bea] })
      )
    ).toBe("bad_member");
    expect(
      await codeOf(
        reorderWorkers(prisma, one.owner, {
          memberIds: [...before.slice(1).map(([id]) => id), fx.members.bea],
        })
      )
    ).toBe("bad_member");
    expect(await positionsOf(one.businessId)).toEqual(before);
    // Rights: a worker of another business and the business's own non-owner.
    expect(await codeOf(reorderWorkers(prisma, fx.ana, { memberIds: before.map(([id]) => id) }))).toBe(
      "forbidden"
    );
    expect(await positionsOf(one.businessId)).toEqual(before);
  });

  it("Review Focus 5: reorder + add in parallel -> never a duplicate or a gap; the reorder is saved or bad_member (12 rounds)", async () => {
    const { owner, businessId } = await freshBusiness("Race");
    for (let round = 0; round < 12; round++) {
      const ids = (await positionsOf(businessId)).map(([id]) => id);
      const [reordered, added] = await Promise.all([
        codeOf(reorderWorkers(prisma, owner, { memberIds: [...ids].reverse() })),
        codeOf(addDeskWorker(prisma, owner, { displayName: `N${round}` })),
      ]);
      expect(added).toBe("ok");
      expect(["ok", "bad_member"]).toContain(reordered);
      const all = await positionsOf(businessId);
      expect(all).toHaveLength(ids.length + 1);
      expect(all.map(([, position]) => position)).toEqual(all.map((_, index) => index));
    }
  });
});
