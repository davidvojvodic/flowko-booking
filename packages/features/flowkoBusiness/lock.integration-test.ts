// @vitest-environment node
// Flowko U25: the strict lock on a real database with Cal's Prisma extensions (prismock ignores them and unique
// keys). Proves: a business set-up composed in one transaction rolls back completely on a real unique violation
// (Ruling 9); several desk-only users (NULL username) fit the unique indexes; after lockMember a locked worker
// cannot sign in (password or magic link), a refresh of her session throws, a fresh cookie gives no server
// session, tRPC's isAuthed lookup finds nobody, Flowko access is gone while the member list still shows her
// LOCKED, mail to her primary and secondary address is suppressed, and her username still blocks a business
// slug (Review Focus 1); unlock reverses it. Runs only with VITEST_MODE=integration against the throwaway DB.
// Node environment: next-auth's JWT encryption (jose) rejects jsdom's Uint8Array (another realm).

import process from "node:process";
import { ErrorCode } from "@calcom/features/auth/lib/ErrorCode";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { authorizeCredentials, getOptions } from "@calcom/features/auth/lib/next-auth-options";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { hashPassword } from "@calcom/lib/auth/hashPassword";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import type { NextApiRequest } from "next";
import { encode } from "next-auth/jwt";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getBusinessAccess, listMembers } from "./access";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import { makeDeskEmail } from "./deskEmail";
import type { GoogleDisconnect } from "./disconnectGoogle";
import { lockMember, unlockMember } from "./lock";
import { lockedRecipientAddresses } from "./lockedRecipients";
import { businessSlugProblem } from "./nameSpace";
import { FlowkoSessionEndedError } from "./sessionGuard";

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
  return { businesses, members, services, serviceWorkers, users };
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

  it("lockMember: member LOCKED, Cal User.locked, Google disconnect after the commit, future bookings listed", async () => {
    const disconnectGoogle = vi.fn(async (_userId: number): Promise<GoogleDisconnect> => "none");

    const result = await lockMember({ db: prisma, disconnectGoogle }, owner.id, anaMemberId, NOW);

    expect(result.status).toBe("LOCKED");
    expect(result.google).toBe("none");
    expect(result.futureBookings.map((b) => b.id)).toEqual([anaBookingId]);
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

  it("locking a desk-only worker leaves Cal's User.locked false (P3)", async () => {
    const result = await lockMember(
      { db: prisma, disconnectGoogle: vi.fn(async () => "none" as const) },
      owner.id,
      mojca.memberId,
      NOW
    );
    expect(result.status).toBe("LOCKED");
    const member = await prisma.flowkoBusinessMember.findUnique({
      where: { id: mojca.memberId },
      select: { status: true },
    });
    expect(member?.status).toBe(FlowkoMemberStatus.LOCKED);
    expect(await calLocked(mojca.userId)).toBe(false);
  });

  it("unlock: member ACTIVE, User.locked false, she signs in again and has access", async () => {
    await expect(unlockMember(prisma, owner.id, anaMemberId)).resolves.toEqual({ status: "ACTIVE" });

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
