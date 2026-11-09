// Flowko U27: the worker mirror services on prismock. Business A (owner Olga, login workers Ana and Bor, desk-only
// Cene, staff Rok with a login, locked worker Dan) and B (owner Zala, worker Bea). Covers M2 (every mirror event
// type field), M4 (one empty schedule per worker, owned by the worker, business time zone), M5 (default schedule
// of a user without one), M6 (a business booking is a booking on a mirror), idempotency, the refusals and the
// D2 predicate nonOwnerMemberOf. Prismock ignores unique keys: mirror.schema.integration-test.ts proves them on
// Postgres, and mirror.integration-test.ts runs Cal's own slot engine on a mirror.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; mirror.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import {
  businessBookingById,
  businessBookingByUid,
  ensureWorkerMirror,
  mirrorIdsOfUser,
  mirrorOfEventType,
  mirrorReminders,
  nonOwnerMemberOf,
  updateBusinessMirrors,
} from "./mirror";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
let seq = 0;

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Who = "olga" | "ana" | "bor" | "cene" | "rok" | "dan" | "zala" | "bea";
type Fixture = {
  a: number;
  b: number;
  aSlug: string;
  users: Record<Who, number>;
  members: Record<Who, number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const aSlug = `salon-a-${seq}`;
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: aSlug,
    templateId: "hair-salon",
  });
  const a = created.businessId;
  // Prismock does not apply @default([]) to scalar lists (test-only).
  await prismock.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [] } });

  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, a, bor, FlowkoBusinessRole.WORKER);
  const cene = await createDeskOnlyWorker(db, a, "Cene");
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, a, dan, FlowkoBusinessRole.WORKER);
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
  });
  await prismock.flowkoBusiness.update({ where: { id: createdB.businessId }, data: { openHolidays: [] } });
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

  return {
    a,
    b: createdB.businessId,
    aSlug,
    users: { olga, ana, bor, cene: cene.userId, rok, dan, zala, bea },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      rok: rokMember.memberId,
      dan: danMember.memberId,
      zala: createdB.ownerMemberId,
      bea: beaMember.memberId,
    },
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

async function counts() {
  return {
    eventTypes: await prismock.eventType.count(),
    schedules: await prismock.schedule.count(),
    availability: await prismock.availability.count(),
    mirrors: await prismock.flowkoWorkerMirror.count(),
  };
}

async function scheduleFor(userId: number, name: string): Promise<number> {
  const schedule = await prismock.schedule.create({ data: { name, userId }, select: { id: true } });
  return schedule.id;
}

async function defaultScheduleOf(userId: number): Promise<number | null> {
  const user = await prismock.user.findFirst({
    where: { id: userId, OR: [{ locked: false }, { locked: true }] },
    select: { defaultScheduleId: true },
  });
  if (!user) throw new Error("fixture: user missing");
  return user.defaultScheduleId;
}

let seqBooking = 0;
async function bookingOn(eventTypeId: number | null, userId: number): Promise<{ id: number; uid: string }> {
  seqBooking += 1;
  const uid = `u27-booking-${seqBooking}`;
  const booking = await prismock.booking.create({
    data: {
      uid,
      title: "Booking",
      startTime: new Date("2026-11-16T09:00:00Z"),
      endTime: new Date("2026-11-16T09:30:00Z"),
      eventTypeId,
      userId,
    },
    select: { id: true, uid: true },
  });
  return booking;
}

let f: Fixture;

beforeEach(async () => {
  f = await setUp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureWorkerMirror (M2, M4)", () => {
  it("creates one hidden mirror event type with every M2 field, one empty schedule and one mirror row", async () => {
    const before = await counts();
    const create = vi.spyOn(prismock.eventType, "create");
    const mirror = await ensureWorkerMirror(tx, f.members.ana);

    expect(mirror.businessId).toBe(f.a);
    expect(mirror.memberId).toBe(f.members.ana);

    // Prismock does not keep implicit many-to-many links: the users connect is checked on the create call here
    // and on Postgres in mirror.integration-test.ts.
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.users).toEqual({ connect: [{ id: f.users.ana }] });
    expect(data.owner).toEqual({ connect: { id: f.users.ana } });
    for (const key of ["team", "teamId", "parent", "parentId", "profile", "profileId", "hosts"]) {
      expect(data).not.toHaveProperty(key);
    }

    const eventType = await prismock.eventType.findUnique({ where: { id: mirror.eventTypeId } });
    if (!eventType) throw new Error("mirror event type missing");
    expect(eventType.title).toBe("Salon A");
    expect(eventType.slug).toBe(`flowko-termin-${f.members.ana}`);
    expect(eventType.length).toBe(30);
    expect(eventType.hidden).toBe(true);
    expect(eventType.userId).toBe(f.users.ana);
    expect(eventType.scheduleId).toBe(mirror.scheduleId);
    expect(eventType.hideOrganizerEmail).toBe(true);
    expect(eventType.customReplyToEmail).toBeNull();
    expect(eventType.disableRescheduling).toBe(true);
    expect(eventType.disableCancelling).toBe(false);
    expect(eventType.disableGuests).toBe(true);
    expect(eventType.eventName).toBe("{Event type title}");
    expect(eventType.requiresConfirmation).toBe(false);
    expect(eventType.locations).toEqual([]);
    expect(eventType.metadata).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [1440] },
    });
    expect(eventType.teamId ?? null).toBeNull();
    expect(eventType.parentId ?? null).toBeNull();
    expect(eventType.profileId ?? null).toBeNull();

    const schedule = await prismock.schedule.findUnique({
      where: { id: mirror.scheduleId },
      include: { availability: true },
    });
    if (!schedule) throw new Error("mirror schedule missing");
    expect(schedule.userId).toBe(f.users.ana);
    expect(schedule.name).toBe("Flowko termini");
    expect(schedule.timeZone).toBe("Europe/Ljubljana");
    expect(schedule.availability).toEqual([]);
    expect(await prismock.availability.count({ where: { scheduleId: mirror.scheduleId } })).toBe(0);

    const rows = await prismock.flowkoWorkerMirror.findMany({ where: { memberId: f.members.ana } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: f.a,
      memberId: f.members.ana,
      eventTypeId: mirror.eventTypeId,
      scheduleId: mirror.scheduleId,
    });

    expect(await counts()).toEqual({
      eventTypes: before.eventTypes + 1,
      schedules: before.schedules + 1,
      availability: before.availability,
      mirrors: before.mirrors + 1,
    });
  });

  it("takes the schedule's time zone from the business", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { timeZone: "Europe/Vienna" } });
    const mirror = await ensureWorkerMirror(tx, f.members.bor);
    const schedule = await prismock.schedule.findUnique({ where: { id: mirror.scheduleId } });
    expect(schedule?.timeZone).toBe("Europe/Vienna");
  });

  it("is idempotent: a second call returns the same ids and creates nothing", async () => {
    const first = await ensureWorkerMirror(tx, f.members.ana);
    const after = await counts();
    const second = await ensureWorkerMirror(tx, f.members.ana);
    expect(second).toEqual(first);
    expect(await counts()).toEqual(after);
  });

  it("gives every worker of the business (owner, desk-only, locked) their own mirror", async () => {
    const olga = await ensureWorkerMirror(tx, f.members.olga);
    const cene = await ensureWorkerMirror(tx, f.members.cene);
    const dan = await ensureWorkerMirror(tx, f.members.dan);
    const bea = await ensureWorkerMirror(tx, f.members.bea);
    expect(new Set([olga.eventTypeId, cene.eventTypeId, dan.eventTypeId, bea.eventTypeId]).size).toBe(4);
    expect(bea.businessId).toBe(f.b);
    const beaEventType = await prismock.eventType.findUnique({ where: { id: bea.eventTypeId } });
    expect(beaEventType?.title).toBe("Salon B");
    expect(beaEventType?.userId).toBe(f.users.bea);
    const ceneSchedule = await prismock.schedule.findUnique({ where: { id: cene.scheduleId } });
    expect(ceneSchedule?.userId).toBe(f.users.cene);
  });

  it("refuses (bad_member) a STAFF member, a member without a login and a missing member, writing nothing", async () => {
    const staffNoLogin = await addStaffWithoutLogin(db, f.a, "Recepcija");
    const before = await counts();
    expect(await outcome(ensureWorkerMirror(tx, f.members.rok))).toBe("bad_member");
    expect(await outcome(ensureWorkerMirror(tx, staffNoLogin.memberId))).toBe("bad_member");
    expect(await outcome(ensureWorkerMirror(tx, 987654))).toBe("bad_member");
    expect(await counts()).toEqual(before);
  });

  it("writes no Team, Membership, Host, HostGroup or Profile row", async () => {
    for (const who of ["olga", "ana", "bor", "cene", "dan", "zala", "bea"] as const) {
      await ensureWorkerMirror(tx, f.members[who]);
    }
    expect(await prismock.team.count()).toBe(0);
    expect(await prismock.membership.count()).toBe(0);
    expect(await prismock.host.count()).toBe(0);
    expect(await prismock.hostGroup.count()).toBe(0);
    expect(await prismock.profile.count()).toBe(0);
  });
});

// Flowko U29a (S4): the create path reads the business's current name, time zone and reminder choice under a
// FOR SHARE row lock ($queryRaw; prismock answers [] there, so the prisma read fallback runs in these tests).
describe("ensureWorkerMirror takes the business's current settings (U29a S4)", () => {
  it("reads name, time zone and reminder choice with FOR SHARE on the create path only", async () => {
    const queryRaw = vi.spyOn(prismock, "$queryRaw");
    await ensureWorkerMirror(tx, f.members.ana);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = (queryRaw.mock.calls[0][0] as unknown as TemplateStringsArray).join("?");
    expect(sql).toMatch(/FROM "FlowkoBusiness" WHERE "id" = \? FOR SHARE/);
    expect(queryRaw.mock.calls[0][1]).toBe(f.a);

    await ensureWorkerMirror(tx, f.members.ana); // existing mirror: no lock, no read
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("a renamed business: the new mirror's title is the current name", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { name: "Salon Nova" } });
    const mirror = await ensureWorkerMirror(tx, f.members.ana);
    const eventType = await prismock.eventType.findUnique({ where: { id: mirror.eventTypeId } });
    expect(eventType?.title).toBe("Salon Nova");
  });

  it.each([
    [[120], { enabled: true, offsets: [120] }],
    [[1440, 120], { enabled: true, offsets: [1440, 120] }],
    [[], { enabled: false, offsets: [1440] }],
  ])("reminderOffsets %j → flowkoReminders %j", async (reminderOffsets, flowkoReminders) => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { reminderOffsets } });
    const mirror = await ensureWorkerMirror(tx, f.members.bor);
    const eventType = await prismock.eventType.findUnique({ where: { id: mirror.eventTypeId } });
    expect(eventType?.metadata).toStrictEqual({ flowkoMirror: true, flowkoReminders });
  });

  it("a business without a stored list (prismock ignores list defaults) gets the 24-hour reminder", async () => {
    const zala = await makeUser("Zala");
    const created = await prismock.flowkoBusiness.create({
      data: { name: "Salon C", slug: `salon-c-${seq}`, openingHours: {} },
      select: { id: true },
    });
    const member = await prismock.flowkoBusinessMember.create({
      data: { businessId: created.id, userId: zala, role: FlowkoBusinessRole.OWNER, displayName: "Zala" },
      select: { id: true },
    });
    const mirror = await ensureWorkerMirror(tx, member.id);
    const eventType = await prismock.eventType.findUnique({ where: { id: mirror.eventTypeId } });
    expect(eventType?.metadata).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [1440] },
    });
  });
});

describe("mirrorReminders (U29a S4)", () => {
  it("[] switches reminders off and keeps a valid offsets list; otherwise the offsets as given", () => {
    expect(mirrorReminders([])).toStrictEqual({ enabled: false, offsets: [1440] });
    expect(mirrorReminders([1440])).toStrictEqual({ enabled: true, offsets: [1440] });
    expect(mirrorReminders([120])).toStrictEqual({ enabled: true, offsets: [120] });
    expect(mirrorReminders([1440, 120])).toStrictEqual({ enabled: true, offsets: [1440, 120] });
  });

  it("the stored list is copied, never shared", () => {
    const stored = [120];
    const reminders = mirrorReminders(stored);
    stored.push(1440);
    expect(reminders.offsets).toEqual([120]);
  });
});

describe("updateBusinessMirrors (U29a S4)", () => {
  async function metadataOf(eventTypeId: number): Promise<unknown> {
    const eventType = await prismock.eventType.findUnique({ where: { id: eventTypeId } });
    return eventType?.metadata;
  }
  async function titleOf(eventTypeId: number): Promise<string | undefined> {
    const eventType = await prismock.eventType.findUnique({ where: { id: eventTypeId } });
    return eventType?.title;
  }

  it("a new title reaches every mirror of the business and no other event type", async () => {
    const ana = await ensureWorkerMirror(tx, f.members.ana);
    const olga = await ensureWorkerMirror(tx, f.members.olga);
    const bea = await ensureWorkerMirror(tx, f.members.bea);
    const own = await prismock.eventType.create({
      data: { title: "Posvet", slug: "posvet-u29a", length: 30, userId: f.users.olga },
      select: { id: true },
    });
    await updateBusinessMirrors(tx, f.a, { title: "Salon Nova" });
    expect(await titleOf(ana.eventTypeId)).toBe("Salon Nova");
    expect(await titleOf(olga.eventTypeId)).toBe("Salon Nova");
    expect(await titleOf(bea.eventTypeId)).toBe("Salon B");
    expect(await titleOf(own.id)).toBe("Posvet");
    // Reminders untouched by a rename.
    expect(await metadataOf(ana.eventTypeId)).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [1440] },
    });
  });

  it("a new reminder choice reaches every mirror of the business; [] switches them off", async () => {
    const ana = await ensureWorkerMirror(tx, f.members.ana);
    const dan = await ensureWorkerMirror(tx, f.members.dan);
    const bea = await ensureWorkerMirror(tx, f.members.bea);
    await updateBusinessMirrors(tx, f.a, { reminderOffsets: [120] });
    for (const id of [ana.eventTypeId, dan.eventTypeId]) {
      expect(await metadataOf(id)).toStrictEqual({
        flowkoMirror: true,
        flowkoReminders: { enabled: true, offsets: [120] },
      });
    }
    await updateBusinessMirrors(tx, f.a, { reminderOffsets: [] });
    expect(await metadataOf(ana.eventTypeId)).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: false, offsets: [1440] },
    });
    expect(await metadataOf(bea.eventTypeId)).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [1440] },
    });
    expect(await titleOf(ana.eventTypeId)).toBe("Salon A");
  });

  it("a mirror whose metadata holds another key keeps it after a reminder change (no schema parse)", async () => {
    const ana = await ensureWorkerMirror(tx, f.members.ana);
    await prismock.eventType.update({
      where: { id: ana.eventTypeId },
      data: {
        metadata: { flowkoMirror: true, flowkoReminders: { enabled: true, offsets: [1440] }, other: 7 },
      },
    });
    await updateBusinessMirrors(tx, f.a, { reminderOffsets: [1440, 120] });
    expect(await metadataOf(ana.eventTypeId)).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [1440, 120] },
      other: 7,
    });
  });

  it("a mirror with non-object metadata gets a fresh mirror metadata", async () => {
    const ana = await ensureWorkerMirror(tx, f.members.ana);
    await prismock.eventType.update({ where: { id: ana.eventTypeId }, data: { metadata: [1, 2] } });
    await updateBusinessMirrors(tx, f.a, { reminderOffsets: [120] });
    expect(await metadataOf(ana.eventTypeId)).toStrictEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: true, offsets: [120] },
    });
  });

  it("nothing to change, or a business without mirrors: no event type write", async () => {
    const updateMany = vi.spyOn(prismock.eventType, "updateMany");
    const update = vi.spyOn(prismock.eventType, "update");
    await updateBusinessMirrors(tx, f.a, { title: "Salon Nova", reminderOffsets: [120] });
    await ensureWorkerMirror(tx, f.members.ana);
    await updateBusinessMirrors(tx, f.a, {});
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("ensureWorkerMirror default schedule (M5)", () => {
  it("a user without a default and with older schedules gets the lowest-id one as default", async () => {
    const older = await scheduleFor(f.users.ana, "Delovni čas");
    await scheduleFor(f.users.ana, "Drugi");
    expect(await defaultScheduleOf(f.users.ana)).toBeNull();
    const mirror = await ensureWorkerMirror(tx, f.members.ana);
    expect(await defaultScheduleOf(f.users.ana)).toBe(older);
    expect(older).not.toBe(mirror.scheduleId);
  });

  it("a locked worker's user is read too (Cal's locked-user filter is opted out)", async () => {
    const older = await scheduleFor(f.users.dan, "Delovni čas");
    await ensureWorkerMirror(tx, f.members.dan);
    expect(await defaultScheduleOf(f.users.dan)).toBe(older);
  });

  it("a user without any other schedule keeps a null default", async () => {
    await ensureWorkerMirror(tx, f.members.cene);
    expect(await defaultScheduleOf(f.users.cene)).toBeNull();
  });

  it("a user with a default keeps it", async () => {
    await scheduleFor(f.users.olga, "Prvi");
    const chosen = await scheduleFor(f.users.olga, "Izbrani");
    await prismock.user.update({ where: { id: f.users.olga }, data: { defaultScheduleId: chosen } });
    await ensureWorkerMirror(tx, f.members.olga);
    expect(await defaultScheduleOf(f.users.olga)).toBe(chosen);
  });
});

describe("mirror lookups", () => {
  it("mirrorOfEventType: the mirror for a mirror event type, null otherwise", async () => {
    const mirror = await ensureWorkerMirror(tx, f.members.ana);
    expect(await mirrorOfEventType(db, mirror.eventTypeId)).toEqual(mirror);
    const own = await prismock.eventType.create({
      data: { title: "Striženje", slug: "strizenje", length: 30, userId: f.users.olga },
      select: { id: true },
    });
    expect(await mirrorOfEventType(db, own.id)).toBeNull();
    expect(await mirrorOfEventType(db, null)).toBeNull();
    expect(await mirrorOfEventType(db, undefined)).toBeNull();
    expect(await mirrorOfEventType(db, 987654)).toBeNull();
  });

  it("businessBookingByUid / ById (M6): a booking on a mirror is a business booking, any other is not", async () => {
    const mirror = await ensureWorkerMirror(tx, f.members.ana);
    const onMirror = await bookingOn(mirror.eventTypeId, f.users.ana);
    const own = await prismock.eventType.create({
      data: { title: "Posvet", slug: "posvet", length: 30, userId: f.users.olga },
      select: { id: true },
    });
    const onOwn = await bookingOn(own.id, f.users.olga);
    const noEventType = await bookingOn(null, f.users.olga);

    const expected = {
      bookingId: onMirror.id,
      uid: onMirror.uid,
      businessId: f.a,
      businessSlug: f.aSlug,
      memberId: f.members.ana,
      eventTypeId: mirror.eventTypeId,
    };
    expect(await businessBookingByUid(db, onMirror.uid)).toEqual(expected);
    expect(await businessBookingById(db, onMirror.id)).toEqual(expected);

    expect(await businessBookingByUid(db, onOwn.uid)).toBeNull();
    expect(await businessBookingById(db, onOwn.id)).toBeNull();
    expect(await businessBookingByUid(db, noEventType.uid)).toBeNull();
    expect(await businessBookingById(db, noEventType.id)).toBeNull();
    expect(await businessBookingByUid(db, "no-such-uid")).toBeNull();
    expect(await businessBookingById(db, 987654)).toBeNull();
  });

  it("mirrorIdsOfUser: the user's mirror event type and schedule, empty for anyone without one", async () => {
    const mirror = await ensureWorkerMirror(tx, f.members.ana);
    expect(await mirrorIdsOfUser(db, f.users.ana)).toEqual({
      eventTypeIds: [mirror.eventTypeId],
      scheduleIds: [mirror.scheduleId],
    });
    expect(await mirrorIdsOfUser(db, f.users.bor)).toEqual({ eventTypeIds: [], scheduleIds: [] });
    const stranger = await makeUser("Tujec");
    expect(await mirrorIdsOfUser(db, stranger)).toEqual({ eventTypeIds: [], scheduleIds: [] });
  });
});

describe("nonOwnerMemberOf (D2)", () => {
  it("WORKER / STAFF with the business slug for any status; null for an owner and a non-member", async () => {
    expect(await nonOwnerMemberOf(db, f.users.ana)).toEqual({ role: "WORKER", businessSlug: f.aSlug });
    expect(await nonOwnerMemberOf(db, f.users.cene)).toEqual({ role: "WORKER", businessSlug: f.aSlug });
    expect(await nonOwnerMemberOf(db, f.users.rok)).toEqual({ role: "STAFF", businessSlug: f.aSlug });
    expect(await nonOwnerMemberOf(db, f.users.dan)).toEqual({ role: "WORKER", businessSlug: f.aSlug });
    expect(await nonOwnerMemberOf(db, f.users.olga)).toBeNull();
    expect(await nonOwnerMemberOf(db, f.users.zala)).toBeNull();
    const stranger = await makeUser("Tujec");
    expect(await nonOwnerMemberOf(db, stranger)).toBeNull();
  });
});
