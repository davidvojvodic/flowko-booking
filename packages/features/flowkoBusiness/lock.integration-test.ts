// @vitest-environment node
// Flowko U25: the strict lock on a real database with Cal's Prisma extensions (prismock ignores them and unique
// keys). Proves: a business set-up composed in one transaction rolls back completely on a real unique violation
// (Ruling 9); several desk-only users (NULL username) fit the unique indexes; after lockMember a locked worker
// cannot sign in (password or magic link), a refresh of her session throws, a fresh cookie gives no server
// session, tRPC's isAuthed lookup finds nobody, Flowko access is gone while the member list still shows her
// LOCKED, mail to her primary and secondary address is suppressed, and her username still blocks a business
// slug (Review Focus 1); unlock reverses it. The business set-up writes no Team, Membership, Host, Profile or
// EventType row (R14, Teams guard). Runs only with VITEST_MODE=integration against the throwaway DB.
// Flowko U29c (Task 4, W2/W3): lockMember answers futureCount from the mirror (Ana's private Cal booking is not
// counted) and calls no Google disconnect for a desk-only worker; unlockMember takes `now`. The second describe
// proves the locks with real business bookings from the U27 writer: Review Focus 4 (20 rounds of a booking racing
// the lock, for a login and a desk-only worker: no deadlock, a committed booking is counted, otherwise it was
// refused worker_locked), a booking holding the worker lock is waited for, lock racing unlock leaves member status
// and User.locked agreeing (FLOWKO.md U25 check = 0), and unlock of an ACTIVE member keeps a Cal-admin lock.
// Node environment: next-auth's JWT encryption (jose) rejects jsdom's Uint8Array (another realm).

import process from "node:process";
import { ErrorCode } from "@calcom/features/auth/lib/ErrorCode";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { authorizeCredentials, getOptions } from "@calcom/features/auth/lib/next-auth-options";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { hashPassword } from "@calcom/lib/auth/hashPassword";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import type { NextApiRequest } from "next";
import { encode } from "next-auth/jwt";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getBusinessAccess, listMembers } from "./access";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import { makeDeskEmail } from "./deskEmail";
import type { GoogleDisconnect } from "./disconnectGoogle";
import { FlowkoBusinessError } from "./errors";
import { lockMember, unlockMember } from "./lock";
import { lockedRecipientAddresses } from "./lockedRecipients";
import { businessSlugProblem } from "./nameSpace";
import { setUsualWeek } from "./roster";
import { FlowkoSessionEndedError } from "./sessionGuard";
import { lockWorkerAdvisory } from "./workerLock";

vi.hoisted(() => {
  vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "u25-test-key-0123456789abcdefghi");
  vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", "http://localhost:3000");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("NEXTAUTH_SECRET", "u25-integration-test-secret-not-a-real-one");
});

// Ruling 9: makeDeskEmail can be told to hand out an address that already exists (a real unique violation).
vi.mock("./deskEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deskEmail")>();
  return { ...actual, makeDeskEmail: vi.fn(actual.makeDeskEmail) };
});

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = "U25-correct-horse-battery";
const NOW = new Date();
const HOUR = 3_600_000;

type TestUser = { id: number; email: string; username: string };

async function loginUser(name: string): Promise<TestUser> {
  const username = `${name}-${RUN}`;
  const email = `${username}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      username,
      name,
      emailVerified: new Date(),
      completedOnboarding: true,
      password: { create: { hash: await hashPassword(PASSWORD) } },
    },
    select: { id: true },
  });
  return { id: user.id, email, username };
}

async function flowkoRowCounts() {
  const [businesses, members, services, serviceWorkers, users] = await Promise.all([
    prisma.flowkoBusiness.count(),
    prisma.flowkoBusinessMember.count(),
    prisma.flowkoService.count(),
    prisma.flowkoServiceWorker.count(),
    prisma.user.count(),
  ]);
  return { businesses, members, services, serviceWorkers, users, ...(await teamsRowCounts()) };
}

/** The upstream rows the business set-up must never write (R14; the PermissionCheckService stubs need none). */
async function teamsRowCounts() {
  const [teams, memberships, hosts, profiles, eventTypes] = await Promise.all([
    prisma.team.count(),
    prisma.membership.count(),
    prisma.host.count(),
    prisma.profile.count(),
    prisma.eventType.count(),
  ]);
  return { teams, memberships, hosts, profiles, eventTypes };
}

/** A request carrying a freshly encoded session cookie for the user (never seen by the session cache). */
async function requestWithSession(user: TestUser): Promise<NextApiRequest> {
  const jwt = await encode({
    token: { sub: String(user.id), email: user.email, name: user.username, jti: `${RUN}-${Math.random()}` },
    secret: process.env.NEXTAUTH_SECRET as string,
  });
  return {
    headers: { cookie: `next-auth.session-token=${jwt}` },
    cookies: { "next-auth.session-token": jwt },
  } as unknown as NextApiRequest;
}

/** Cal's User.locked, read with the excludeLockedUsers opt-out. */
async function calLocked(userId: number): Promise<boolean | undefined> {
  const user = await prisma.user.findFirst({
    where: { id: userId, OR: [{ locked: false }, { locked: true }] },
    select: { locked: true },
  });
  return user?.locked;
}

const options = getOptions({ getDubId: () => undefined, getTrackingData: () => ({}) as never });
// next-auth's callback parameters need a full Account/User; the test passes the fields the callbacks read.
const callbacks = options.callbacks as unknown as {
  jwt: (params: Record<string, unknown>) => Promise<unknown>;
  signIn: (params: Record<string, unknown>) => Promise<unknown>;
};

function magicLinkSignIn(email: string, userId: number) {
  return callbacks.signIn({
    user: { id: String(userId), email, emailVerified: null },
    account: { provider: "email", type: "email", providerAccountId: email },
    email: { verificationRequest: true },
  });
}

describe("strict worker lock on a real database", () => {
  let owner: TestUser;
  let ana: TestUser;
  let bojan: TestUser;
  let anaAltEmail: string;
  let businessId: number;
  let anaMemberId: number;
  let cene: { memberId: number; userId: number };
  let mojca: { memberId: number; userId: number };
  let anaBookingId: number;

  beforeAll(async () => {
    owner = await loginUser("owner");
    ana = await loginUser("ana");
    bojan = await loginUser("bojan");
    anaAltEmail = `ana.alt-${RUN}@example.com`;
    await prisma.secondaryEmail.create({
      data: { userId: ana.id, email: anaAltEmail, emailVerified: new Date() },
    });

    const created = await createBusiness(prisma, {
      ownerUserId: owner.id,
      name: "Salon U25",
      slug: `salon-${RUN}`,
      templateId: "hair-salon",
    });
    businessId = created.businessId;
    anaMemberId = (await addLoginMember(prisma, businessId, ana.id, FlowkoBusinessRole.WORKER)).memberId;
    cene = await createDeskOnlyWorker(prisma, businessId, "Cene");
    mojca = await createDeskOnlyWorker(prisma, businessId, "Mojca");

    const booking = await prisma.booking.create({
      data: {
        uid: `u25-ana-${RUN}`,
        title: "Striženje",
        startTime: new Date(NOW.getTime() + 24 * HOUR),
        endTime: new Date(NOW.getTime() + 25 * HOUR),
        userId: ana.id,
        status: BookingStatus.ACCEPTED,
      },
      select: { id: true },
    });
    anaBookingId = booking.id;
  });

  it("several desk-only users fit the unique indexes (NULL usernames, distinct placeholder addresses)", async () => {
    const desk = await prisma.user.findMany({
      where: { id: { in: [cene.userId, mojca.userId] } },
      select: { username: true, email: true },
    });
    expect(desk).toHaveLength(2);
    expect(desk.map((u) => u.username)).toEqual([null, null]);
    expect(new Set(desk.map((u) => u.email)).size).toBe(2);
  });

  it("the business set-up writes no Team, Membership, Host, Profile or EventType row", async () => {
    expect(await teamsRowCounts()).toEqual({
      teams: 0,
      memberships: 0,
      hosts: 0,
      profiles: 0,
      eventTypes: 0,
    });
  });

  it("a set-up composed in one transaction leaves no Flowko row and no user when a later step fails", async () => {
    const before = await flowkoRowCounts();
    vi.mocked(makeDeskEmail).mockReturnValueOnce(ana.email);

    const outcome = await prisma
      .$transaction(async (tx) => {
        const second = await createBusiness(tx, {
          ownerUserId: bojan.id,
          name: "Salon Rollback",
          slug: `rollback-${RUN}`,
          templateId: "hair-salon",
        });
        await createDeskOnlyWorker(tx, second.businessId, "Neja");
      })
      .then(
        () => null,
        (e: unknown) => e
      );

    expect(outcome).toMatchObject({ code: "P2002" });
    expect(await flowkoRowCounts()).toEqual(before);
    expect(await prisma.flowkoBusiness.findFirst({ where: { slug: `rollback-${RUN}` } })).toBeNull();
    expect(await prisma.flowkoBusinessMember.findFirst({ where: { userId: bojan.id } })).toBeNull();
  });

  it("before the lock Ana signs in and holds a session (positive control)", async () => {
    await expect(
      authorizeCredentials({ email: ana.email, password: PASSWORD } as never)
    ).resolves.toMatchObject({
      id: ana.id,
    });
    expect(await getServerSession({ req: await requestWithSession(ana) })).toMatchObject({
      user: { id: ana.id },
    });
    await expect(callbacks.jwt({ token: { sub: String(ana.id), email: ana.email } })).resolves.toBeTruthy();
    expect(await getBusinessAccess(prisma, ana.id)).not.toBeNull();
  });

  it("lockMember: member LOCKED, Cal User.locked, Google disconnect after the commit, futureCount from the mirror", async () => {
    const disconnectGoogle = vi.fn(async (_userId: number): Promise<GoogleDisconnect> => "none");

    const result = await lockMember({ db: prisma, disconnectGoogle }, owner.id, anaMemberId, NOW);

    expect(result.status).toBe("LOCKED");
    expect(result.google).toBe("none");
    // Flowko U29c: Ana's only booking is a private Cal booking (no mirror): it exists, but is not counted (C12).
    expect(await prisma.booking.count({ where: { id: anaBookingId } })).toBe(1);
    expect(result.futureCount).toBe(0);
    expect(Object.keys(result).sort()).toEqual(["futureCount", "google", "status"]);
    expect(disconnectGoogle).toHaveBeenCalledWith(ana.id);
    const member = await prisma.flowkoBusinessMember.findUnique({
      where: { id: anaMemberId },
      select: { status: true, lockedAt: true, user: { select: { id: true, locked: true } } },
    });
    expect(member?.status).toBe(FlowkoMemberStatus.LOCKED);
    expect(member?.lockedAt).toEqual(NOW);
    // Settles the open fact: a nested user select through the member relation is not filtered by the extension.
    expect(member?.user).toEqual({ id: ana.id, locked: true });
    expect(await calLocked(ana.id)).toBe(true);
  });

  it("the locked worker cannot sign in with her right password (the extension hides her first)", async () => {
    await expect(authorizeCredentials({ email: ana.email, password: PASSWORD } as never)).rejects.toThrow(
      ErrorCode.IncorrectEmailPassword
    );
  });

  it("no magic link for the locked worker nor for a desk-only worker", async () => {
    expect(await magicLinkSignIn(ana.email, ana.id)).not.toBe(true);
    const ceneUser = await prisma.user.findFirst({ where: { id: cene.userId }, select: { email: true } });
    expect(ceneUser).not.toBeNull();
    expect(await magicLinkSignIn(ceneUser?.email as string, cene.userId)).not.toBe(true);
  });

  it("her session refresh throws FlowkoSessionEndedError; the owner's does not", async () => {
    await expect(callbacks.jwt({ token: { sub: String(ana.id), email: ana.email } })).rejects.toBeInstanceOf(
      FlowkoSessionEndedError
    );
    await expect(
      callbacks.jwt({ token: { sub: String(ana.id), email: ana.email }, trigger: "update", session: {} })
    ).rejects.toBeInstanceOf(FlowkoSessionEndedError);
    await expect(
      callbacks.jwt({ token: { sub: String(owner.id), email: owner.email } })
    ).resolves.toMatchObject({
      sub: String(owner.id),
    });
  });

  it("a fresh cookie gives her no server session, and tRPC's isAuthed lookup finds nobody", async () => {
    expect(await getServerSession({ req: await requestWithSession(ana) })).toBeNull();
    expect(await getServerSession({ req: await requestWithSession(owner) })).toMatchObject({
      user: { id: owner.id },
    });
    expect(await new UserRepository(prisma).findUnlockedUserForSession({ userId: ana.id })).toBeNull();
  });

  it("Flowko access is gone, the member list still shows her LOCKED", async () => {
    expect(await getBusinessAccess(prisma, ana.id)).toBeNull();
    const members = await listMembers(prisma, businessId);
    expect(members.find((m) => m.memberId === anaMemberId)).toMatchObject({
      userId: ana.id,
      status: FlowkoMemberStatus.LOCKED,
      deskOnly: false,
    });
  });

  it("her primary and secondary addresses are locked recipients, any case; a customer is not", async () => {
    const locked = await lockedRecipientAddresses([
      ana.email.toUpperCase(),
      anaAltEmail.toUpperCase(),
      "stranka@example.com",
    ]);
    expect(locked).toEqual(new Set([ana.email, anaAltEmail]));
  });

  it("her username still blocks a business slug although she is locked (Review Focus 1)", async () => {
    await expect(businessSlugProblem(prisma, ana.username)).resolves.toBe("user");
  });

  it("pinned for U27: Cal's findByIdOrThrow cannot load a locked organizer (Cal's cancel breaks)", async () => {
    await expect(new UserRepository(prisma).findByIdOrThrow({ id: ana.id })).rejects.toThrow();
  });

  it("locking a desk-only worker leaves Cal's User.locked false (P3) and calls no Google disconnect", async () => {
    // Flowko U29c: a desk-only worker cannot hold Google grants; google "none" without a call (W2).
    const disconnectGoogle = vi.fn(async (): Promise<GoogleDisconnect> => "disconnected");
    const result = await lockMember({ db: prisma, disconnectGoogle }, owner.id, mojca.memberId, NOW);
    expect(result).toEqual({ status: "LOCKED", google: "none", futureCount: 0 });
    expect(disconnectGoogle).not.toHaveBeenCalled();
    const member = await prisma.flowkoBusinessMember.findUnique({
      where: { id: mojca.memberId },
      select: { status: true },
    });
    expect(member?.status).toBe(FlowkoMemberStatus.LOCKED);
    expect(await calLocked(mojca.userId)).toBe(false);
  });

  it("unlock: member ACTIVE, User.locked false, she signs in again and has access", async () => {
    await expect(unlockMember(prisma, owner.id, anaMemberId, NOW)).resolves.toEqual({ status: "ACTIVE" });

    expect(await calLocked(ana.id)).toBe(false);
    await expect(
      authorizeCredentials({ email: ana.email, password: PASSWORD } as never)
    ).resolves.toMatchObject({
      id: ana.id,
    });
    expect(await getBusinessAccess(prisma, ana.id)).not.toBeNull();
    await expect(callbacks.jwt({ token: { sub: String(ana.id), email: ana.email } })).resolves.toBeTruthy();
    expect(await lockedRecipientAddresses([ana.email, anaAltEmail])).toEqual(new Set());
  });
});

// Flowko U29c (Task 4): the worker advisory lock and the member row lock with real business bookings.
describe("U29c lock and unlock under concurrency (W2, W3, Review Focus 4)", () => {
  const TZ = "Europe/Ljubljana";
  const FIXED_NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
  const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
  const quiet: WriterDeps = { googleBusy: async () => ({ busy: [], unavailable: false }), sendMails: false };
  const noGoogle = vi.fn(async (): Promise<GoogleDisconnect> => "none");
  const ROUNDS = 20;
  // 24 distinct hourly slots (Tue to Thu, 08:00 to 15:00): a 30-minute service never overlaps the round before.
  const SLOTS = ["2026-11-17", "2026-11-18", "2026-11-19"].flatMap((date) =>
    ["08", "09", "10", "11", "12", "13", "14", "15"].map((h) => at(date, `${h}:00`))
  );

  let olga: number;
  let mens: number;
  let worker: { memberId: number; userId: number };
  let desk: { memberId: number; userId: number };
  let spare: { memberId: number; userId: number };

  async function realUser(name: string): Promise<number> {
    const username = `${name.toLowerCase()}-u29c-${RUN}`;
    const user = await prisma.user.create({
      data: { email: `${username}@example.com`, username, name, timeZone: TZ, completedOnboarding: true },
      select: { id: true },
    });
    return user.id;
  }

  async function outcome(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "ok";
    } catch (e) {
      if (e instanceof FlowkoBusinessError) return e.code;
      throw e;
    }
  }

  function book(memberId: number, start: Date, deps: WriterDeps = quiet) {
    const input: CreateBookingInput = {
      workerMemberId: memberId,
      serviceIds: [mens],
      start,
      customer: { name: "Marija Novak", phone: "041 123 456", email: `marija-${RUN}@example.com` },
      confirmOverride: false,
    };
    return createBusinessBooking(prisma, olga, input, FIXED_NOW, deps);
  }

  async function mirrorBookingCount(memberId: number): Promise<number> {
    const mirror = await prisma.flowkoWorkerMirror.findUnique({
      where: { memberId },
      select: { eventTypeId: true },
    });
    if (!mirror) return 0;
    return prisma.booking.count({
      where: { eventTypeId: mirror.eventTypeId, status: BookingStatus.ACCEPTED, endTime: { gt: FIXED_NOW } },
    });
  }

  /** FLOWKO.md's U25 post-deploy check: members whose lock flag differs from their user's (desk aside). */
  async function lockDisagreements(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM "FlowkoBusinessMember" m JOIN users u ON u.id = m."userId"
      WHERE (m.status = 'LOCKED') <> u.locked AND u.email NOT LIKE '%@flowko.invalid'`;
    return Number(rows[0].count);
  }

  beforeAll(async () => {
    olga = await realUser("Olga");
    const created = await createBusiness(prisma, {
      ownerUserId: olga,
      name: `Salon U29c ${RUN}`,
      slug: `salon-u29c-${RUN}`,
      templateId: "hair-salon",
      phone: "01 234 56 78",
    });
    await prisma.flowkoBusiness.update({ where: { id: created.businessId }, data: { openHolidays: [] } });
    mens = created.serviceIds[0]; // "Moško striženje", 30 minutes
    const login = await realUser("Iva");
    worker = {
      memberId: (await addLoginMember(prisma, created.businessId, login, FlowkoBusinessRole.WORKER)).memberId,
      userId: login,
    };
    desk = await createDeskOnlyWorker(prisma, created.businessId, "Lara");
    const spareUser = await realUser("Spela");
    spare = {
      memberId: (await addLoginMember(prisma, created.businessId, spareUser, FlowkoBusinessRole.WORKER))
        .memberId,
      userId: spareUser,
    };
    const hours: ShiftEntry[] = [{ from: "08:00", to: "16:00" }];
    const week: WeekHours = { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: [], sun: [] };
    for (const member of [worker, desk, spare]) {
      await prisma.flowkoServiceWorker.create({ data: { serviceId: mens, memberId: member.memberId } });
      await setUsualWeek(prisma, olga, {
        memberId: member.memberId,
        usualWeek: week,
        confirmOutsideOpening: false,
      });
    }
  });

  for (const which of ["login worker", "desk-only worker"] as const) {
    it(`Review Focus 4 (${which}): ${ROUNDS} rounds of a booking racing the lock: no deadlock, every committed booking is counted`, async () => {
      const member = which === "login worker" ? worker : desk;
      const tally = { created: 0, refused: 0 };
      for (let round = 0; round < ROUNDS; round += 1) {
        if (
          (await prisma.flowkoBusinessMember.findUnique({ where: { id: member.memberId } }))?.status ===
          "LOCKED"
        )
          await unlockMember(prisma, olga, member.memberId, FIXED_NOW);
        const before = await mirrorBookingCount(member.memberId);
        // The lock starts 0 to 12 ms later, round by round, so both orders occur.
        const lockLater = new Promise<void>((resolve) => setTimeout(resolve, (round % 5) * 3)).then(() =>
          lockMember({ db: prisma, disconnectGoogle: noGoogle }, olga, member.memberId, FIXED_NOW)
        );
        const [booked, locked] = await Promise.all([outcome(book(member.memberId, SLOTS[round])), lockLater]);

        expect(["ok", "worker_locked"]).toContain(booked);
        if (booked === "ok") tally.created += 1;
        else tally.refused += 1;
        const after = await mirrorBookingCount(member.memberId);
        expect(after).toBe(before + (booked === "ok" ? 1 : 0));
        // Exact: the count read after the lock's commit holds every booking that committed (none can follow).
        expect(locked).toMatchObject({ status: "LOCKED", futureCount: after });
      }
      expect(tally.created + tally.refused).toBe(ROUNDS);
      expect(await lockDisagreements()).toBe(0);
    });

    it(`a booking holding the ${which}'s lock is waited for: it commits ACTIVE and is counted`, async () => {
      const member = which === "login worker" ? worker : desk;
      await unlockMember(prisma, olga, member.memberId, FIXED_NOW);
      const before = await mirrorBookingCount(member.memberId);
      let held!: () => void;
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const slowWriter: WriterDeps = {
        ...quiet,
        lockWorker: async (tx, userId) => {
          await lockWorkerAdvisory(tx, userId);
          held();
          await new Promise((resolve) => setTimeout(resolve, 400));
        },
      };
      const booking = book(member.memberId, at("2026-11-20", "10:00"), slowWriter);
      await holding;
      const locked = await lockMember(
        { db: prisma, disconnectGoogle: noGoogle },
        olga,
        member.memberId,
        FIXED_NOW
      );

      expect((await booking).status).toBe("created");
      expect(locked.futureCount).toBe(before + 1);
      expect(await mirrorBookingCount(member.memberId)).toBe(before + 1);
    });
  }

  it("lock racing unlock (20 rounds): member status and User.locked always agree (FLOWKO.md U25 check = 0)", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const [locked, unlocked] = await Promise.all([
        outcome(lockMember({ db: prisma, disconnectGoogle: noGoogle }, olga, spare.memberId, FIXED_NOW)),
        new Promise<void>((resolve) => setTimeout(resolve, (round % 4) * 2)).then(() =>
          outcome(unlockMember(prisma, olga, spare.memberId, FIXED_NOW))
        ),
      ]);
      expect(locked).toBe("ok");
      expect(["ok", "member_not_locked"]).toContain(unlocked);
      const row = await prisma.flowkoBusinessMember.findUnique({
        where: { id: spare.memberId },
        select: { status: true, user: { select: { locked: true } } },
      });
      expect(row?.user?.locked).toBe(row?.status === FlowkoMemberStatus.LOCKED);
      expect(await lockDisagreements()).toBe(0);
    }
  });

  it("unlock of an ACTIVE member is member_not_locked and keeps a Cal-admin lock on the user", async () => {
    if (
      (await prisma.flowkoBusinessMember.findUnique({ where: { id: spare.memberId } }))?.status === "LOCKED"
    )
      await unlockMember(prisma, olga, spare.memberId, FIXED_NOW);
    await prisma.user.update({ where: { id: spare.userId }, data: { locked: true } });

    expect(await outcome(unlockMember(prisma, olga, spare.memberId, FIXED_NOW))).toBe("member_not_locked");

    expect(await calLocked(spare.userId)).toBe(true);
    const row = await prisma.flowkoBusinessMember.findUnique({
      where: { id: spare.memberId },
      select: { status: true, lockedAt: true },
    });
    expect(row).toEqual({ status: FlowkoMemberStatus.ACTIVE, lockedAt: null });
    await prisma.user.update({ where: { id: spare.userId }, data: { locked: false } });
  });
});
