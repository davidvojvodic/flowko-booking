// Flowko U25: the business access module on prismock. Two businesses: A (owner, workers Ana and Bor, desk-only
// Cene, staff Rok with a login, locked worker Dan, staff Tea without a login) and B (owner Zala). Covers the
// see/act split (R8, P11), cross-business refusal, missing = foreign (same FORBIDDEN), and A1: a booking created
// before its organizer joined stays private (P10).
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; the module takes `db` and never imports it.
import "@calcom/prisma";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BookingIntent,
  type BookingOrganizer,
  type BusinessAccess,
  getBusinessAccess,
  listMembers,
  type MemberView,
  mayBookFor,
  mayEditRoster,
  mayManageBusiness,
  mayOnBooking,
  requireBookingAccess,
  requireBusinessAccess,
} from "./access";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";

const db = prismock as unknown as FlowkoDb;
const MINUTE = 60_000;
let seq = 0;

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

async function memberSince(userId: number): Promise<Date> {
  const member = await prismock.flowkoBusinessMember.findFirst({ where: { userId } });
  if (!member) throw new Error("fixture: no member");
  return member.createdAt;
}

/** A booking organized by `userId`; created one minute after the organizer joined unless `createdAt` is given. */
async function makeBooking(userId: number | null, createdAt?: Date): Promise<number> {
  seq += 1;
  const when = createdAt ?? (userId === null ? new Date() : await joinedPlus(userId));
  const booking = await prismock.booking.create({
    data: {
      uid: `uid-${seq}`,
      title: `Booking ${seq}`,
      startTime: new Date("2026-12-01T09:00:00Z"),
      endTime: new Date("2026-12-01T10:00:00Z"),
      userId,
      createdAt: when,
    },
    select: { id: true },
  });
  return booking.id;
}

async function joinedPlus(userId: number): Promise<Date> {
  const member = await prismock.flowkoBusinessMember.findFirst({ where: { userId } });
  // A user in no business: any time works.
  return new Date((member?.createdAt ?? new Date()).getTime() + MINUTE);
}

type Fixture = {
  a: number;
  b: number;
  users: {
    owner: number;
    ana: number;
    bor: number;
    cene: number;
    rok: number;
    dan: number;
    zala: number;
    lone: number;
  };
  members: {
    owner: number;
    ana: number;
    bor: number;
    cene: number;
    rok: number;
    dan: number;
    tea: number;
    zala: number;
  };
  bookings: {
    owner: number;
    ana: number;
    anaBeforeJoining: number;
    bor: number;
    rok: number;
    b: number;
    lone: number;
    noOrganizer: number;
  };
};

async function setUp(): Promise<Fixture> {
  const owner = await makeUser("Owner");
  const created = await createBusiness(db, {
    ownerUserId: owner,
    name: "Salon A",
    slug: "salon-a",
    templateId: "hair-salon",
  });
  const a = created.businessId;

  const ana = await makeUser("Ana");
  const bor = await makeUser("Bor");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(db, a, bor, FlowkoBusinessRole.WORKER);
  const cene = await createDeskOnlyWorker(db, a, "Cene");
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, a, dan, FlowkoBusinessRole.WORKER);
  const tea = await addStaffWithoutLogin(db, a, "Tea");
  // Lock Dan the way Task 6's lock will: member LOCKED + User.locked (a fixture update, not a nested write).
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  await prismock.user.update({ where: { id: dan }, data: { locked: true } });

  const zala = await makeUser("Zala");
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: "salon-b",
    templateId: "hair-salon",
  });
  const lone = await makeUser("Lone");

  const anaJoined = await memberSince(ana);
  return {
    a,
    b: createdB.businessId,
    users: { owner, ana, bor, cene: cene.userId, rok, dan, zala, lone },
    members: {
      owner: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      rok: rokMember.memberId,
      dan: danMember.memberId,
      tea: tea.memberId,
      zala: createdB.ownerMemberId,
    },
    bookings: {
      owner: await makeBooking(owner),
      ana: await makeBooking(ana),
      anaBeforeJoining: await makeBooking(ana, new Date(anaJoined.getTime() - 60 * MINUTE)),
      bor: await makeBooking(bor),
      rok: await makeBooking(rok),
      b: await makeBooking(zala),
      lone: await makeBooking(lone),
      noOrganizer: await makeBooking(null),
    },
  };
}

async function accessOf(userId: number): Promise<BusinessAccess> {
  const access = await getBusinessAccess(db, userId);
  if (!access) throw new Error("fixture: no access");
  return access;
}

/** The organizer + createdAt of a stored booking, built the way requireBookingAccess builds them. */
async function organizerOf(bookingId: number): Promise<{ organizer: BookingOrganizer; createdAt: Date }> {
  const booking = await prismock.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.userId === null) throw new Error("fixture: booking without organizer");
  const member = await prismock.flowkoBusinessMember.findFirst({ where: { userId: booking.userId } });
  return {
    organizer: {
      userId: booking.userId,
      businessId: member?.businessId ?? null,
      memberSince: member?.createdAt ?? null,
    },
    createdAt: booking.createdAt,
  };
}

async function forbiddenError(promise: Promise<unknown>): Promise<FlowkoBusinessError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(FlowkoBusinessError);
  expect(error).toMatchObject({ code: "forbidden", message: "forbidden" });
  return error as FlowkoBusinessError;
}

function refOf(members: MemberView[], memberId: number): MemberView {
  const ref = members.find((m) => m.memberId === memberId);
  if (!ref) throw new Error("fixture: no member view");
  return ref;
}

let f: Fixture;

beforeEach(async () => {
  f = await setUp();
});

type Actor = "owner" | "ana" | "rok";
type BookingKey = keyof Fixture["bookings"];

// {OWNER, WORKER, STAFF} × {own, colleague's, B's, organizer without business} × {see, act}.
const TABLE: Array<{ actor: Actor; label: string; booking: BookingKey; see: boolean; act: boolean }> = [
  { actor: "owner", label: "own", booking: "owner", see: true, act: true },
  { actor: "owner", label: "colleague's", booking: "bor", see: true, act: true },
  { actor: "owner", label: "B's", booking: "b", see: false, act: false },
  { actor: "owner", label: "organizer without business", booking: "lone", see: false, act: false },
  { actor: "ana", label: "own", booking: "ana", see: true, act: true },
  { actor: "ana", label: "colleague's", booking: "bor", see: true, act: false },
  { actor: "ana", label: "owner's", booking: "owner", see: true, act: false },
  { actor: "ana", label: "B's", booking: "b", see: false, act: false },
  { actor: "ana", label: "organizer without business", booking: "lone", see: false, act: false },
  { actor: "rok", label: "own (staff organizer)", booking: "rok", see: true, act: true },
  { actor: "rok", label: "colleague's", booking: "ana", see: true, act: true },
  { actor: "rok", label: "owner's", booking: "owner", see: true, act: true },
  { actor: "rok", label: "B's", booking: "b", see: false, act: false },
  { actor: "rok", label: "organizer without business", booking: "lone", see: false, act: false },
];

describe("mayOnBooking and requireBookingAccess (Review Focus 3)", () => {
  for (const row of TABLE) {
    for (const intent of ["see", "act"] as BookingIntent[]) {
      const expected = row[intent];
      it(`${row.actor} ${intent} ${row.label} booking → ${expected}`, async () => {
        const access = await accessOf(f.users[row.actor]);
        const bookingId = f.bookings[row.booking];
        const { organizer, createdAt } = await organizerOf(bookingId);

        expect(mayOnBooking(access, organizer, { createdAt }, intent)).toBe(expected);

        if (expected) {
          const result = await requireBookingAccess(db, f.users[row.actor], bookingId, intent);
          expect(result.access).toEqual(access);
          expect(result.booking).toEqual({
            id: bookingId,
            uid: expect.any(String),
            userId: organizer.userId,
            createdAt,
          });
        } else {
          await forbiddenError(requireBookingAccess(db, f.users[row.actor], bookingId, intent));
        }
      });
    }
  }

  it("Bor acts on his own booking", async () => {
    await expect(requireBookingAccess(db, f.users.bor, f.bookings.bor, "act")).resolves.toMatchObject({
      booking: { id: f.bookings.bor },
    });
  });

  it("A1: Ana's booking from before she joined is private to the business (owner, staff, Bor, Ana)", async () => {
    const { organizer, createdAt } = await organizerOf(f.bookings.anaBeforeJoining);
    expect(organizer.memberSince).not.toBeNull();
    expect(createdAt.getTime()).toBeLessThan((organizer.memberSince as Date).getTime());

    for (const actor of ["owner", "rok", "bor", "ana"] as const) {
      const access = await accessOf(f.users[actor]);
      for (const intent of ["see", "act"] as BookingIntent[]) {
        expect(mayOnBooking(access, organizer, { createdAt }, intent)).toBe(false);
        await forbiddenError(requireBookingAccess(db, f.users[actor], f.bookings.anaBeforeJoining, intent));
      }
    }
  });

  it("A1 boundary: a booking created at the moment the organizer joined belongs to the business", async () => {
    const access = await accessOf(f.users.owner);
    const { organizer } = await organizerOf(f.bookings.ana);
    const since = organizer.memberSince as Date;
    expect(mayOnBooking(access, organizer, { createdAt: since }, "see")).toBe(true);
    expect(mayOnBooking(access, organizer, { createdAt: new Date(since.getTime() - 1) }, "see")).toBe(false);
  });

  it("an organizer with a business but no join date is refused (fail closed)", async () => {
    const access = await accessOf(f.users.owner);
    const organizer: BookingOrganizer = { userId: f.users.ana, businessId: f.a, memberSince: null };
    expect(mayOnBooking(access, organizer, { createdAt: new Date() }, "see")).toBe(false);
  });

  it("B's booking and a missing id get the same FORBIDDEN for owner, staff and worker", async () => {
    for (const actor of ["owner", "rok", "ana"] as const) {
      for (const intent of ["see", "act"] as BookingIntent[]) {
        const foreign = await forbiddenError(requireBookingAccess(db, f.users[actor], f.bookings.b, intent));
        const missing = await forbiddenError(requireBookingAccess(db, f.users[actor], 999999, intent));
        expect(missing.message).toBe(foreign.message);
        expect(missing.code).toBe(foreign.code);
      }
    }
  });

  it("a booking without an organizer is forbidden", async () => {
    await forbiddenError(requireBookingAccess(db, f.users.owner, f.bookings.noOrganizer, "see"));
  });

  it("a locked member, a desk-only user and a user in no business get FORBIDDEN on any booking", async () => {
    for (const userId of [f.users.dan, f.users.cene, f.users.lone]) {
      await forbiddenError(requireBookingAccess(db, userId, f.bookings.owner, "see"));
      await forbiddenError(requireBookingAccess(db, userId, f.bookings.lone, "see"));
    }
    // Dan's and Cene's own bookings too: no Flowko access path at all.
    const danBooking = await makeBooking(f.users.dan);
    const ceneBooking = await makeBooking(f.users.cene);
    await forbiddenError(requireBookingAccess(db, f.users.dan, danBooking, "see"));
    await forbiddenError(requireBookingAccess(db, f.users.cene, ceneBooking, "see"));
  });

  it("a locked worker's bookings stay visible to the owner (history kept)", async () => {
    const danBooking = await makeBooking(f.users.dan);
    await expect(requireBookingAccess(db, f.users.owner, danBooking, "act")).resolves.toMatchObject({
      booking: { id: danBooking },
    });
  });
});

describe("getBusinessAccess / requireBusinessAccess", () => {
  it("returns business, member, user and role for active login members", async () => {
    expect(await getBusinessAccess(db, f.users.owner)).toEqual({
      businessId: f.a,
      memberId: f.members.owner,
      userId: f.users.owner,
      role: FlowkoBusinessRole.OWNER,
    });
    expect(await getBusinessAccess(db, f.users.ana)).toEqual({
      businessId: f.a,
      memberId: f.members.ana,
      userId: f.users.ana,
      role: FlowkoBusinessRole.WORKER,
    });
    expect(await getBusinessAccess(db, f.users.rok)).toEqual({
      businessId: f.a,
      memberId: f.members.rok,
      userId: f.users.rok,
      role: FlowkoBusinessRole.STAFF,
    });
    expect(await getBusinessAccess(db, f.users.zala)).toMatchObject({
      businessId: f.b,
      memberId: f.members.zala,
    });
  });

  it("is null for a LOCKED member (Dan), a desk address (Cene), a user in no business and an unknown id", async () => {
    expect(await getBusinessAccess(db, f.users.dan)).toBeNull();
    expect(await getBusinessAccess(db, f.users.cene)).toBeNull();
    expect(await getBusinessAccess(db, f.users.lone)).toBeNull();
    expect(await getBusinessAccess(db, 999999)).toBeNull();
  });

  it("is null for an ACTIVE member whose user is Cal-locked (fail closed)", async () => {
    await prismock.user.update({ where: { id: f.users.bor }, data: { locked: true } });
    expect(await getBusinessAccess(db, f.users.bor)).toBeNull();
  });

  it("requireBusinessAccess returns the access or throws forbidden", async () => {
    await expect(requireBusinessAccess(db, f.users.ana)).resolves.toMatchObject({ memberId: f.members.ana });
    for (const userId of [f.users.dan, f.users.cene, f.users.lone, 999999]) {
      await forbiddenError(requireBusinessAccess(db, userId));
    }
  });
});

describe("mayManageBusiness", () => {
  it("is true for the owner only", async () => {
    expect(mayManageBusiness(await accessOf(f.users.owner))).toBe(true);
    expect(mayManageBusiness(await accessOf(f.users.ana))).toBe(false);
    expect(mayManageBusiness(await accessOf(f.users.rok))).toBe(false);
  });
});

describe("mayBookFor", () => {
  it("owner and staff book for any active column of the business; a worker only for self", async () => {
    const members = await listMembers(db, f.a);
    const owner = await accessOf(f.users.owner);
    const ana = await accessOf(f.users.ana);
    const rok = await accessOf(f.users.rok);

    expect(mayBookFor(rok, refOf(members, f.members.cene))).toBe(true);
    expect(mayBookFor(rok, refOf(members, f.members.owner))).toBe(true);
    expect(mayBookFor(owner, refOf(members, f.members.ana))).toBe(true);
    expect(mayBookFor(owner, refOf(members, f.members.owner))).toBe(true);
    expect(mayBookFor(ana, refOf(members, f.members.ana))).toBe(true);
    expect(mayBookFor(ana, refOf(members, f.members.bor))).toBe(false);
    expect(mayBookFor(ana, refOf(members, f.members.owner))).toBe(false);
  });

  it("nobody books for a LOCKED member, a member without a column, or another business's member", async () => {
    const members = await listMembers(db, f.a);
    const membersB = await listMembers(db, f.b);
    const actors = [await accessOf(f.users.owner), await accessOf(f.users.ana), await accessOf(f.users.rok)];
    for (const access of actors) {
      expect(mayBookFor(access, refOf(members, f.members.dan))).toBe(false);
      expect(mayBookFor(access, refOf(members, f.members.rok))).toBe(false);
      expect(mayBookFor(access, refOf(members, f.members.tea))).toBe(false);
      expect(mayBookFor(access, refOf(membersB, f.members.zala))).toBe(false);
    }
  });
});

describe("mayEditRoster", () => {
  it("owner edits any column of the business; a worker only self; staff never", async () => {
    const members = await listMembers(db, f.a);
    const membersB = await listMembers(db, f.b);
    const owner = await accessOf(f.users.owner);
    const ana = await accessOf(f.users.ana);
    const rok = await accessOf(f.users.rok);

    expect(mayEditRoster(owner, refOf(members, f.members.owner))).toBe(true);
    expect(mayEditRoster(owner, refOf(members, f.members.ana))).toBe(true);
    expect(mayEditRoster(owner, refOf(members, f.members.cene))).toBe(true);
    expect(mayEditRoster(owner, refOf(members, f.members.dan))).toBe(true);
    expect(mayEditRoster(owner, refOf(members, f.members.rok))).toBe(false);
    expect(mayEditRoster(owner, refOf(membersB, f.members.zala))).toBe(false);

    expect(mayEditRoster(ana, refOf(members, f.members.ana))).toBe(true);
    expect(mayEditRoster(ana, refOf(members, f.members.bor))).toBe(false);
    expect(mayEditRoster(ana, refOf(members, f.members.owner))).toBe(false);

    for (const ref of [...members, ...membersB]) {
      expect(mayEditRoster(rok, ref)).toBe(false);
    }
  });
});

describe("listMembers", () => {
  it("lists every member of the business in join order, LOCKED included, with column and desk flags", async () => {
    const userFindMany = vi.spyOn(prismock.user, "findMany");
    const members = await listMembers(db, f.a);
    expect(userFindMany).not.toHaveBeenCalled();

    expect(members).toEqual([
      {
        memberId: f.members.owner,
        businessId: f.a,
        role: FlowkoBusinessRole.OWNER,
        status: FlowkoMemberStatus.ACTIVE,
        userId: f.users.owner,
        displayName: "Owner",
        deskOnly: false,
        hasColumn: true,
      },
      {
        memberId: f.members.ana,
        businessId: f.a,
        role: FlowkoBusinessRole.WORKER,
        status: FlowkoMemberStatus.ACTIVE,
        userId: f.users.ana,
        displayName: "Ana",
        deskOnly: false,
        hasColumn: true,
      },
      {
        memberId: f.members.bor,
        businessId: f.a,
        role: FlowkoBusinessRole.WORKER,
        status: FlowkoMemberStatus.ACTIVE,
        userId: f.users.bor,
        displayName: "Bor",
        deskOnly: false,
        hasColumn: true,
      },
      {
        memberId: f.members.cene,
        businessId: f.a,
        role: FlowkoBusinessRole.WORKER,
        status: FlowkoMemberStatus.ACTIVE,
        userId: f.users.cene,
        displayName: "Cene",
        deskOnly: true,
        hasColumn: true,
      },
      {
        memberId: f.members.rok,
        businessId: f.a,
        role: FlowkoBusinessRole.STAFF,
        status: FlowkoMemberStatus.ACTIVE,
        userId: f.users.rok,
        displayName: "Rok",
        deskOnly: false,
        hasColumn: false,
      },
      {
        memberId: f.members.dan,
        businessId: f.a,
        role: FlowkoBusinessRole.WORKER,
        status: FlowkoMemberStatus.LOCKED,
        userId: f.users.dan,
        displayName: "Dan",
        deskOnly: false,
        hasColumn: true,
      },
      {
        memberId: f.members.tea,
        businessId: f.a,
        role: FlowkoBusinessRole.STAFF,
        status: FlowkoMemberStatus.ACTIVE,
        userId: null,
        displayName: "Tea",
        deskOnly: false,
        hasColumn: false,
      },
    ]);
  });

  it("orders by position, then id", async () => {
    // Move Ana to the end and give Bor the same position as the owner: position wins, then id.
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.ana }, data: { position: 99 } });
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.bor }, data: { position: 0 } });
    const ids = (await listMembers(db, f.a)).map((m) => m.memberId);
    expect(ids).toEqual([
      f.members.owner,
      f.members.bor,
      f.members.cene,
      f.members.rok,
      f.members.dan,
      f.members.tea,
      f.members.ana,
    ]);
  });

  it("lists only the given business", async () => {
    const members = await listMembers(db, f.b);
    expect(members.map((m) => m.memberId)).toEqual([f.members.zala]);
  });
});
