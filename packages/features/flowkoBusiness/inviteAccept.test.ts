// Flowko U29d: the public accept side on prismock (A1 loader, A3 brand-new member, A4 usual-week copy). Business A
// (owner Olga with a usual week; login worker Ana; desk-only workers Mojca and Lara) and B (owner Zala).
// NOW = 2026-11-16T07:07:00Z (Mon 08:07 in Ljubljana). `hashPassword` is a stub. Covers: one `invalid` answer
// with no other key for every unusable token and a side-effect-free page read; the brand-new accept's user and
// member rows, the copy of the owner's usual week (WORKER only, editor rules), single use, no bcrypt work for a
// dead token, C6 inside the accept, the name rules, the P2002 / lock-failure mapping outside the transaction, and
// no Team / Membership / Profile / Host / Schedule / VerificationToken row. Locks, real unique violations and
// races: inviteAccept.integration-test.ts.
// Flowko U29d (Task 4, D2, C9): the desk-only conversion keeps the member and user ids, the member row (no write)
// and every row on them (roster day, absence, service, mirror, booking); only the user's identity fields change;
// a LOCKED member, a locked user, an already converted user or a gone member is one invalid answer, without bcrypt.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; inviteAccept.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { MailSendOutcome } from "@calcom/emails/templates/_base-email";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus, IdentityProvider } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBusinessAccess, listMembers } from "./access";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { acceptInvite, readInviteForAcceptPage } from "./inviteAccept";
import { createInvite, type InviteDeps, type InviteMailArgs } from "./invites";
import { lockMember, unlockMember } from "./lock";
import { readUsualWeek } from "./roster";
import { listWorkers } from "./workers";

const db = prismock as unknown as PrismaClient;
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const BASE = "https://booking.example";
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "Geslo123";
const HASH = "$2a$12$stubstubstubstubstubstuOstubstubstubstubstubstubstubstu";

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

let seq = 0;
async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Fixture = {
  a: number;
  b: number;
  users: Record<"olga" | "ana" | "zala", number>;
  members: Record<"olga" | "ana" | "mojca" | "lara", number>;
  // Flowko U29d (Task 4): the desk-only members' placeholder users (the conversion keeps these ids).
  deskUsers: Record<"mojca" | "lara", number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db as unknown as FlowkoDb, {
    ownerUserId: olga,
    name: "Frizerstvo & Co",
    slug: `salon-a-${seq}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
  });
  const a = created.businessId;
  await prismock.flowkoBusinessMember.update({
    where: { id: created.ownerMemberId },
    data: { usualWeek: OWNER_WEEK },
  });
  const ana = await makeUser("Ana");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const mojca = await createDeskOnlyWorker(db, a, "Mojca");
  const lara = await createDeskOnlyWorker(db, a, "Lara");
  const zala = await makeUser("Zala");
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `salon-b-${seq}`,
    templateId: "hair-salon",
    phone: "02 345 67 89",
  });
  return {
    a,
    b: createdB.businessId,
    users: { olga, ana, zala },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      mojca: mojca.memberId,
      lara: lara.memberId,
    },
    deskUsers: { mojca: mojca.userId, lara: lara.userId },
  };
}

function inviteDeps(): InviteDeps {
  return {
    db,
    baseUrl: BASE,
    sendInvite: vi.fn(async (_args: InviteMailArgs): Promise<MailSendOutcome> => "sent"),
  };
}

const tokenOf = (link: string) => link.slice(`${BASE}/auth/pridruzi/`.length);

/** A brand-new invite of business A made by its owner; answers the raw token and the row id. */
async function invite(
  role: "WORKER" | "STAFF" = "WORKER",
  email = " Hana@Example.SI ",
  name = "Hana",
  at: Date = NOW
): Promise<{ token: string; inviteId: number }> {
  const answer = await createInvite(inviteDeps(), f.users.olga, { kind: "new", name, email, role }, at);
  return { token: tokenOf(answer.link), inviteId: answer.inviteId };
}

function hasher() {
  return vi.fn(async (pw: string) => {
    expect(pw).toBe(PASSWORD);
    return HASH;
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
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
    users: await prismock.user.count({ where: { OR: [{ locked: false }, { locked: true }] } }),
    members: await prismock.flowkoBusinessMember.count(),
    passwords: await prismock.userPassword.count(),
    team: await prismock.team.count(),
    membership: await prismock.membership.count(),
    profile: await prismock.profile.count(),
    host: await prismock.host.count(),
    schedule: await prismock.schedule.count(),
    verificationToken: await prismock.verificationToken.count(),
    serviceWorkers: await prismock.flowkoServiceWorker.count(),
  };
}

// prismock never matches an object filter on User.email / SecondaryEmail.email (single-column @@unique, its
// composite-key branch), so `{ equals, mode: "insensitive" }` finds nothing there. This shim answers exactly that
// query shape (findFirst and findMany) as Postgres's ILIKE does; every other call passes through (invites.test.ts
// ruling 1).
// The real query runs on Postgres in inviteAccept.integration-test.ts.
function insensitiveEmailShim() {
  for (const model of [prismock.user, prismock.secondaryEmail] as unknown as Array<{
    findFirst: (args?: { where?: Record<string, unknown> }) => Promise<unknown>;
    findMany: (args?: {
      where?: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => Promise<Array<Record<string, unknown> & { id: number; email: string }>>;
  }>) {
    const originalFirst = model.findFirst.bind(model);
    const originalMany = model.findMany.bind(model);
    // Postgres compiles `{ equals, mode: "insensitive" }` to `ILIKE $1` with the value unescaped (SPEC-2): `_` is
    // any one character, `%` any run, `\` escapes. The shim matches the same way, so a unit case sees the wildcard.
    const literal = (c: string) => c.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&");
    const ilike = (pattern: string) => {
      const source = pattern.replace(
        /\\(.)|([_%])|([^\\_%])/g,
        (_m, escaped?: string, wild?: string, plain?: string) =>
          wild === "_" ? "." : wild === "%" ? ".*" : literal(escaped ?? plain ?? "")
      );
      return new RegExp(`^${source}$`, "i");
    };
    const matches = async (where: Record<string, unknown> | undefined) => {
      const filter = where?.email as { equals?: unknown; mode?: unknown } | undefined;
      if (
        !filter ||
        typeof filter !== "object" ||
        filter.mode !== "insensitive" ||
        typeof filter.equals !== "string"
      )
        return null;
      const { email: _email, ...rest } = where ?? {};
      const pattern = ilike(filter.equals);
      return (await originalMany({ where: rest })).filter((row) => pattern.test(row.email));
    };
    const picked = (row: Record<string, unknown>, select?: Record<string, boolean>) =>
      select
        ? Object.fromEntries(
            Object.keys(select)
              .filter((k) => select[k])
              .map((k) => [k, row[k]])
          )
        : row;
    vi.spyOn(model, "findFirst").mockImplementation(async (args) => {
      const hits = await matches(args?.where);
      if (hits === null) return originalFirst(args);
      return hits[0] ? { id: hits[0].id } : null;
    });
    vi.spyOn(model, "findMany").mockImplementation(async (args) => {
      const hits = await matches(args?.where);
      if (hits === null) return originalMany(args);
      return hits.map((row) => picked(row, args?.select)) as Array<
        Record<string, unknown> & { id: number; email: string }
      >;
    });
  }
}

let f: Fixture;
beforeEach(async () => {
  insensitiveEmailShim();
  f = await setUp();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const INVITE_WRITES = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
] as const;
function spyInviteWrites() {
  const model = prismock.flowkoBusinessInvite as unknown as Record<string, (...args: unknown[]) => unknown>;
  return INVITE_WRITES.map((name) => vi.spyOn(model, name));
}

describe("readInviteForAcceptPage (A1, loader)", () => {
  it("answers exactly { state: 'invalid' } for a malformed, unknown, used, revoked or expired token", async () => {
    const malformed = [
      "",
      "short",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}+`,
      `${"a".repeat(42)}/`,
    ];
    for (const token of malformed) {
      const answer = await readInviteForAcceptPage(db, token, NOW);
      expect(answer).toEqual({ state: "invalid" });
      expect(Object.keys(answer)).toEqual(["state"]);
    }
    expect(await readInviteForAcceptPage(db, "A".repeat(43), NOW)).toEqual({ state: "invalid" });

    const used = await invite("WORKER", "used@example.si", "Uporabljen");
    await prismock.flowkoBusinessInvite.update({ where: { id: used.inviteId }, data: { usedAt: NOW } });
    const revoked = await invite("WORKER", "revoked@example.si", "Preklican");
    await prismock.flowkoBusinessInvite.update({ where: { id: revoked.inviteId }, data: { revokedAt: NOW } });
    const atNow = await invite("WORKER", "atnow@example.si", "Ravno", new Date(NOW.getTime() - 7 * DAY));
    const earlier = await invite("WORKER", "earlier@example.si", "Prej", new Date(NOW.getTime() - 8 * DAY));
    for (const { token } of [used, revoked, atNow, earlier]) {
      const answer = await readInviteForAcceptPage(db, token, NOW);
      expect(answer).toEqual({ state: "invalid" });
      expect(Object.keys(answer)).toEqual(["state"]);
    }
  });

  it("answers the business name, the e-mail, the name and the kind of an open invite (one ms before expiry too)", async () => {
    const { token } = await invite("STAFF");
    expect(await readInviteForAcceptPage(db, token, NOW)).toEqual({
      state: "open",
      businessName: "Frizerstvo & Co",
      email: "hana@example.si",
      name: "Hana",
      kind: "new",
    });
    expect(await readInviteForAcceptPage(db, token, new Date(NOW.getTime() + 7 * DAY - 1))).toMatchObject({
      state: "open",
    });
    expect(await readInviteForAcceptPage(db, token, new Date(NOW.getTime() + 7 * DAY))).toEqual({
      state: "invalid",
    });
  });

  it("a rotated token (resend) is invalid at once; the new one is open", async () => {
    const { token, inviteId } = await invite();
    const { resendInvite } = await import("./invites");
    const answer = await resendInvite(inviteDeps(), f.users.olga, { inviteId, sendMail: false }, NOW);
    expect(await readInviteForAcceptPage(db, token, NOW)).toEqual({ state: "invalid" });
    expect(await readInviteForAcceptPage(db, tokenOf(answer.link), NOW)).toMatchObject({ state: "open" });
  });

  it("a desk-only member's invite is open as kind 'member'; invalid while the member is LOCKED", async () => {
    const answer = await createInvite(
      inviteDeps(),
      f.users.olga,
      { kind: "member", memberId: f.members.mojca, email: "mojca@example.si" },
      NOW
    );
    const token = tokenOf(answer.link);
    expect(await readInviteForAcceptPage(db, token, NOW)).toEqual({
      state: "open",
      businessName: "Frizerstvo & Co",
      email: "mojca@example.si",
      name: "Mojca",
      kind: "member",
    });
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.mojca },
      data: { status: FlowkoMemberStatus.LOCKED, lockedAt: NOW },
    });
    expect(await readInviteForAcceptPage(db, token, NOW)).toEqual({ state: "invalid" });
  });

  it("writes nothing: the row is unchanged and no invite write ran, whatever the token", async () => {
    const { token, inviteId } = await invite();
    const used = await invite("WORKER", "used@example.si", "Uporabljen");
    await prismock.flowkoBusinessInvite.update({ where: { id: used.inviteId }, data: { usedAt: NOW } });
    const before = await prismock.flowkoBusinessInvite.findMany({ orderBy: { id: "asc" } });
    const beforeCounts = await counts();
    const spies = spyInviteWrites();
    await readInviteForAcceptPage(db, token, NOW);
    await readInviteForAcceptPage(db, token, NOW);
    await readInviteForAcceptPage(db, used.token, NOW);
    await readInviteForAcceptPage(db, "x", NOW);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(await prismock.flowkoBusinessInvite.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    expect(
      (await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } })).usedAt
    ).toBeNull();
  });
});

describe("acceptInvite, a brand-new member (A3, A4)", () => {
  it("creates a login user and an ACTIVE WORKER member with the owner's usual week, and uses the invite", async () => {
    const { token, inviteId } = await invite();
    const hashPassword = hasher();
    const lastPosition = Math.max(
      ...(await prismock.flowkoBusinessMember.findMany({ where: { businessId: f.a } })).map((m) => m.position)
    );
    const answer = await acceptInvite(
      { db, hashPassword },
      { token, name: "  Hana Novak  ", password: PASSWORD },
      NOW
    );
    expect(answer).toEqual({ status: "accepted", email: "hana@example.si" });
    expect(hashPassword).toHaveBeenCalledTimes(1);

    const user = await prismock.user.findFirstOrThrow({
      where: { email: "hana@example.si" },
      include: { password: true },
    });
    expect(user).toMatchObject({
      email: "hana@example.si",
      name: "Hana Novak",
      username: null,
      emailVerified: NOW,
      completedOnboarding: true,
      identityProvider: IdentityProvider.CAL,
      locale: "sl",
      timeZone: "Europe/Ljubljana",
      timeFormat: 24,
      weekStart: "Monday",
      locked: false,
    });
    expect(user.password?.hash).toBe(HASH);

    const member = await prismock.flowkoBusinessMember.findFirstOrThrow({ where: { userId: user.id } });
    expect(member).toMatchObject({
      businessId: f.a,
      role: FlowkoBusinessRole.WORKER,
      status: FlowkoMemberStatus.ACTIVE,
      displayName: "Hana Novak",
      position: lastPosition + 1,
    });
    expect(readUsualWeek(member.usualWeek)).toEqual(OWNER_WEEK);
    expect(await prismock.flowkoServiceWorker.count({ where: { memberId: member.id } })).toBe(0);

    const row = await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(row.usedAt).toEqual(NOW);
    expect(row.revokedAt).toBeNull();
    expect(JSON.stringify(answer)).not.toContain(token);
  });

  it("hashes the password before the transaction (bcrypt holds no lock)", async () => {
    const { token } = await invite();
    const order: string[] = [];
    const realTx = prismock.$transaction.bind(prismock);
    vi.spyOn(prismock, "$transaction").mockImplementation((async (arg: unknown) => {
      order.push("tx");
      return (realTx as (a: unknown) => Promise<unknown>)(arg);
    }) as never);
    const hashPassword = vi.fn(async () => {
      order.push("hash");
      return HASH;
    });
    await acceptInvite({ db, hashPassword }, { token, name: "Hana", password: PASSWORD }, NOW);
    expect(order).toEqual(["hash", "tx"]);
  });

  it("the usual week is none when the owner has none, or one that fails the editor rules (> 4 shifts a day)", async () => {
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.olga },
      data: { usualWeek: Prisma.DbNull },
    });
    const first = await invite("WORKER", "prva@example.si", "Prva");
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: first.token, name: "Prva", password: PASSWORD },
      NOW
    );
    const prva = await prismock.flowkoBusinessMember.findFirstOrThrow({ where: { displayName: "Prva" } });
    expect(readUsualWeek(prva.usualWeek)).toBeNull();

    const tooMany = {
      ...OWNER_WEEK,
      tue: [
        e("06:00", "07:00"),
        e("08:00", "09:00"),
        e("10:00", "11:00"),
        e("12:00", "13:00"),
        e("14:00", "15:00"),
      ],
    };
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.olga },
      data: { usualWeek: tooMany },
    });
    const second = await invite("WORKER", "druga@example.si", "Druga");
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: second.token, name: "Druga", password: PASSWORD },
      NOW
    );
    const druga = await prismock.flowkoBusinessMember.findFirstOrThrow({ where: { displayName: "Druga" } });
    expect(readUsualWeek(druga.usualWeek)).toBeNull();
  });

  it("the usual week is read at accept, not at invite", async () => {
    const { token } = await invite();
    const later = { ...OWNER_WEEK, sat: [e("09:00", "13:00")] };
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.olga }, data: { usualWeek: later } });
    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Hana", password: PASSWORD }, NOW);
    const member = await prismock.flowkoBusinessMember.findFirstOrThrow({ where: { displayName: "Hana" } });
    expect(readUsualWeek(member.usualWeek)).toEqual(later);
  });

  it("a brand-new STAFF member gets no usual week and no service rows", async () => {
    const { token } = await invite("STAFF", "recepcija@example.si", "Rea");
    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Rea", password: PASSWORD }, NOW);
    const member = await prismock.flowkoBusinessMember.findFirstOrThrow({ where: { displayName: "Rea" } });
    expect(member).toMatchObject({ role: FlowkoBusinessRole.STAFF, status: FlowkoMemberStatus.ACTIVE });
    expect(readUsualWeek(member.usualWeek)).toBeNull();
    expect(await prismock.flowkoServiceWorker.count({ where: { memberId: member.id } })).toBe(0);
  });

  it("is single use: a second accept of the same token is invite_invalid without bcrypt work", async () => {
    const { token } = await invite();
    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Hana", password: PASSWORD }, NOW);
    const before = await counts();
    const hashPassword = hasher();
    expect(
      await codeOf(acceptInvite({ db, hashPassword }, { token, name: "Hana Druga", password: PASSWORD }, NOW))
    ).toBe("invite_invalid");
    expect(hashPassword).not.toHaveBeenCalled();
    expect(await counts()).toEqual(before);
  });

  it("an expired, revoked, rotated, unknown or malformed token is invite_invalid, no bcrypt, nothing written", async () => {
    const expired = await invite(
      "WORKER",
      "potekel@example.si",
      "Potekel",
      new Date(NOW.getTime() - 7 * DAY)
    );
    const revoked = await invite("WORKER", "preklican@example.si", "Preklican");
    await prismock.flowkoBusinessInvite.update({ where: { id: revoked.inviteId }, data: { revokedAt: NOW } });
    const rotated = await invite("WORKER", "zasukan@example.si", "Zasukan");
    const { resendInvite } = await import("./invites");
    await resendInvite(inviteDeps(), f.users.olga, { inviteId: rotated.inviteId, sendMail: false }, NOW);
    const before = await counts();
    const hashPassword = hasher();
    for (const token of [
      expired.token,
      revoked.token,
      rotated.token,
      "B".repeat(43),
      "nope",
      "a".repeat(44),
    ]) {
      expect(
        await codeOf(acceptInvite({ db, hashPassword }, { token, name: "Hana", password: PASSWORD }, NOW))
      ).toBe("invite_invalid");
    }
    expect(hashPassword).not.toHaveBeenCalled();
    expect(await counts()).toEqual(before);
  });

  it("C6 inside the accept: the e-mail meanwhile has a (locked) user or a secondary e-mail -> email_has_login", async () => {
    const one = await invite("WORKER", "ena@example.si", "Ena");
    const two = await invite("WORKER", "dva@example.si", "Dva");
    await prismock.user.create({
      data: { email: "ENA@Example.si", username: "ena-x", name: "X", locked: true },
    });
    const other = await makeUser("Druga");
    await prismock.secondaryEmail.create({ data: { userId: other, email: "Dva@Example.SI" } });
    const before = await counts();
    for (const { token, inviteId } of [one, two]) {
      expect(
        await codeOf(
          acceptInvite({ db, hashPassword: hasher() }, { token, name: "Nova", password: PASSWORD }, NOW)
        )
      ).toBe("email_has_login");
      expect(
        (await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } })).usedAt
      ).toBeNull();
    }
    expect(await counts()).toEqual(before);
  });

  it("the edited name: a member's name (case and space variants) is member_name_taken; empty or 81 chars bad_member", async () => {
    const { token, inviteId } = await invite();
    const before = await counts();
    for (const name of ["Mojca", "  MOJCA ", "lara", "Olga"]) {
      expect(
        await codeOf(acceptInvite({ db, hashPassword: hasher() }, { token, name, password: PASSWORD }, NOW))
      ).toBe("member_name_taken");
    }
    const hashPassword = hasher();
    for (const name of ["", "   ", "x".repeat(81)]) {
      expect(await codeOf(acceptInvite({ db, hashPassword }, { token, name, password: PASSWORD }, NOW))).toBe(
        "bad_member"
      );
    }
    expect(hashPassword).not.toHaveBeenCalled();
    expect(await counts()).toEqual(before);
    expect(
      (await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } })).usedAt
    ).toBeNull();
    // 80 characters after trim is fine.
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token, name: ` ${"y".repeat(80)} `, password: PASSWORD },
      NOW
    );
    expect(await prismock.flowkoBusinessMember.count({ where: { displayName: "y".repeat(80) } })).toBe(1);
  });

  it("creates no Team, Membership, Profile, Host, Schedule, VerificationToken or service row", async () => {
    const worker = await invite("WORKER", "w@example.si", "Wanda");
    const staff = await invite("STAFF", "s@example.si", "Sonja");
    const before = await counts();
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: worker.token, name: "Wanda", password: PASSWORD },
      NOW
    );
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: staff.token, name: "Sonja", password: PASSWORD },
      NOW
    );
    expect(await counts()).toEqual({
      ...before,
      users: before.users + 2,
      members: before.members + 2,
      passwords: before.passwords + 2,
    });
  });

  describe("unique violations and lock failures, mapped outside the transaction", () => {
    const known = (code: string, meta: Record<string, unknown> = {}) =>
      new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: "6", meta });

    it("a users e-mail P2002 in either shape is email_has_login; another P2002 is rethrown", async () => {
      const shapes = [
        { modelName: "User", driverAdapterError: { cause: { constraint: { fields: ["email"] } } } },
        { target: ["email"], modelName: "User" },
        { target: "users_email_key" },
      ];
      for (const meta of shapes) {
        const { token } = await invite(
          "WORKER",
          `p${shapes.indexOf(meta)}@example.si`,
          `P${shapes.indexOf(meta)}`
        );
        vi.spyOn(prismock.user, "create").mockRejectedValueOnce(known("P2002", meta));
        expect(
          await codeOf(
            acceptInvite({ db, hashPassword: hasher() }, { token, name: "Nova", password: PASSWORD }, NOW)
          )
        ).toBe("email_has_login");
      }
      const { token } = await invite("WORKER", "other@example.si", "Other");
      const otherP2002 = known("P2002", {
        modelName: "FlowkoBusinessMember",
        driverAdapterError: { cause: { constraint: { fields: ["userId"] } } },
      });
      vi.spyOn(prismock.flowkoBusinessMember, "create").mockRejectedValueOnce(otherP2002);
      await expect(
        acceptInvite({ db, hashPassword: hasher() }, { token, name: "Nova", password: PASSWORD }, NOW)
      ).rejects.toBe(otherP2002);
    });

    it("P2028, P2034 and a raw 40P01 are member_conflict", async () => {
      const failures = [
        known("P2028"),
        known("P2034"),
        known("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } }),
      ];
      for (const failure of failures) {
        const { token } = await invite(
          "WORKER",
          `c${failures.indexOf(failure)}@example.si`,
          `C${failures.indexOf(failure)}`
        );
        vi.spyOn(prismock.user, "create").mockRejectedValueOnce(failure);
        expect(
          await codeOf(
            acceptInvite({ db, hashPassword: hasher() }, { token, name: "Nova", password: PASSWORD }, NOW)
          )
        ).toBe("member_conflict");
      }
    });
  });
});

describe("acceptInvite, a desk-only member's conversion (D2, C9)", () => {
  const MEMBER_WRITES = [
    "create",
    "createMany",
    "update",
    "updateMany",
    "upsert",
    "delete",
    "deleteMany",
  ] as const;
  function spyMemberWrites() {
    const model = prismock.flowkoBusinessMember as unknown as Record<string, (...args: unknown[]) => unknown>;
    return MEMBER_WRITES.map((name) => vi.spyOn(model, name));
  }

  /** An open invite of Mojca (desk-only WORKER of business A), made by the owner; answers the raw token. */
  async function inviteMojca(mail = " Mojca@Example.SI "): Promise<{ token: string; inviteId: number }> {
    const answer = await createInvite(
      inviteDeps(),
      f.users.olga,
      { kind: "member", memberId: f.members.mojca, email: mail },
      NOW
    );
    return { token: tokenOf(answer.link), inviteId: answer.inviteId };
  }

  /** The user row with its password, read past Cal's excludeLockedUsers (prismock ignores the extension). */
  const userRow = (id: number) =>
    prismock.user.findFirstOrThrow({
      where: { id, OR: [{ locked: false }, { locked: true }] },
      include: { password: true },
    });

  /** Mojca's column data: a roster day, an absence, a service, a mirror and a booking (all on her ids). */
  async function giveMojcaData(): Promise<void> {
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.mojca },
      data: { usualWeek: OWNER_WEEK },
    });
    await prismock.flowkoRosterDay.create({
      data: {
        memberId: f.members.mojca,
        date: new Date("2026-11-25T00:00:00Z"),
        shifts: [e("09:00", "17:00")],
      },
    });
    await prismock.flowkoAbsence.create({
      data: {
        memberId: f.members.mojca,
        startDate: new Date("2026-12-01T00:00:00Z"),
        endDate: new Date("2026-12-03T00:00:00Z"),
      },
    });
    const service = await prismock.flowkoService.findFirstOrThrow({ where: { businessId: f.a } });
    await prismock.flowkoServiceWorker.create({ data: { serviceId: service.id, memberId: f.members.mojca } });
    const schedule = await prismock.schedule.create({
      data: { userId: f.deskUsers.mojca, name: "Mojca", timeZone: "Europe/Ljubljana" },
    });
    const eventType = await prismock.eventType.create({
      data: { title: "Mojca", slug: `mojca-${seq}`, length: 30, userId: f.deskUsers.mojca, hidden: true },
    });
    await prismock.flowkoWorkerMirror.create({
      data: {
        businessId: f.a,
        memberId: f.members.mojca,
        eventTypeId: eventType.id,
        scheduleId: schedule.id,
      },
    });
    const desk = await userRow(f.deskUsers.mojca);
    await prismock.booking.create({
      data: {
        uid: `mojca-booking-${seq}`,
        title: "Striženje",
        startTime: new Date("2026-11-25T09:00:00Z"),
        endTime: new Date("2026-11-25T09:30:00Z"),
        userId: f.deskUsers.mojca,
        userPrimaryEmail: desk.email,
        eventTypeId: eventType.id,
      },
    });
  }

  /** Everything the conversion must keep: the member row and every row that hangs on Mojca's member or user id. */
  async function mojcaSnapshot() {
    return {
      member: await prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id: f.members.mojca } }),
      rosterDays: await prismock.flowkoRosterDay.findMany({ where: { memberId: f.members.mojca } }),
      absences: await prismock.flowkoAbsence.findMany({ where: { memberId: f.members.mojca } }),
      services: await prismock.flowkoServiceWorker.findMany({ where: { memberId: f.members.mojca } }),
      mirror: await prismock.flowkoWorkerMirror.findUnique({ where: { memberId: f.members.mojca } }),
      bookings: await prismock.booking.findMany({ where: { userId: f.deskUsers.mojca } }),
    };
  }

  it("I10 (SPEC-3): the owner's lock kills the open invite and an unlock revives it; the invite row never changes", async () => {
    const { token, inviteId } = await inviteMojca();
    const row = () => prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } });
    const before = await row();
    const disconnectGoogle = vi.fn(async () => "none" as const);
    await lockMember({ db, disconnectGoogle }, f.users.olga, f.members.mojca, NOW);
    expect(disconnectGoogle).not.toHaveBeenCalled();
    expect((await userRow(f.deskUsers.mojca)).locked).toBe(false);
    expect(await readInviteForAcceptPage(db, token, NOW)).toEqual({ state: "invalid" });
    expect(await row()).toEqual(before);
    await unlockMember(db, f.users.olga, f.members.mojca, NOW);
    expect(await readInviteForAcceptPage(db, token, NOW)).toMatchObject({ state: "open", kind: "member" });
    expect(await row()).toEqual(before);
    expect(
      await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Mojca", password: PASSWORD }, NOW)
    ).toEqual({ status: "accepted", email: "mojca@example.si" });
    expect((await row()).usedAt).toEqual(NOW);
  });

  it("turns the same member and the same user into a login; the member row and its column data are untouched", async () => {
    await giveMojcaData();
    const { token, inviteId } = await inviteMojca();
    const deskEmail = (await userRow(f.deskUsers.mojca)).email;
    const before = await mojcaSnapshot();
    const beforeCounts = await counts();
    const memberWrites = spyMemberWrites();
    // The arguments are copied at call time: prismock rewrites the nested write in place.
    const userWrites: Array<{ where: unknown; data: Record<string, unknown> }> = [];
    const realUpdate = prismock.user.update.bind(prismock.user);
    vi.spyOn(prismock.user, "update").mockImplementation(((args: Parameters<typeof realUpdate>[0]) => {
      userWrites.push(structuredClone(args) as (typeof userWrites)[number]);
      return realUpdate(args);
    }) as never);
    const hashPassword = hasher();

    const answer = await acceptInvite(
      { db, hashPassword },
      { token, name: "  Mojca Novak  ", password: PASSWORD },
      NOW
    );

    expect(answer).toEqual({ status: "accepted", email: "mojca@example.si" });
    expect(hashPassword).toHaveBeenCalledTimes(1);
    for (const spy of memberWrites) expect(spy).not.toHaveBeenCalled();
    // The member row (displayName „Mojca“, position, usualWeek, createdAt, status) and every row on its ids.
    expect(await mojcaSnapshot()).toEqual(before);
    expect(before.rosterDays).toHaveLength(1);
    expect(before.absences).toHaveLength(1);
    expect(before.services).toHaveLength(1);
    expect(before.mirror).not.toBeNull();
    expect(before.bookings).toHaveLength(1);
    // D5: the old booking keeps the desk address it was written with.
    expect(before.bookings[0].userPrimaryEmail).toBe(deskEmail);
    // No new user, no new member: only the password row is new.
    expect(await counts()).toEqual({ ...beforeCounts, passwords: beforeCounts.passwords + 1 });

    const user = await userRow(f.deskUsers.mojca);
    expect(user).toMatchObject({
      id: f.deskUsers.mojca,
      email: "mojca@example.si",
      name: "Mojca Novak",
      username: null,
      emailVerified: NOW,
      identityProvider: IdentityProvider.CAL,
      identityProviderId: null,
      completedOnboarding: true,
      locked: false,
      locale: "sl",
      timeZone: "Europe/Ljubljana",
    });
    // One write of the user row, by id, with the password as an upsert. prismock stores the upsert's create
    // branch without its userId (a prismock gap), so the stored row is proven on Postgres
    // (inviteAccept.integration-test.ts) and the update branch below.
    expect(userWrites).toHaveLength(1);
    const [written] = userWrites;
    expect(written.where).toEqual({ id: f.deskUsers.mojca });
    expect(written.data).toEqual({
      email: "mojca@example.si",
      name: "Mojca Novak",
      password: { upsert: { create: { hash: HASH }, update: { hash: HASH } } },
      emailVerified: NOW,
      identityProvider: IdentityProvider.CAL,
      identityProviderId: null,
      completedOnboarding: true,
    });

    const row = await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(row.usedAt).toEqual(NOW);
    expect(row.revokedAt).toBeNull();
    expect(JSON.stringify(answer)).not.toContain(token);
  });

  it("after it the member is a login member everywhere: listMembers, listWorkers (invite gone) and access", async () => {
    const { token } = await inviteMojca();
    const listed = await listWorkers(db, f.users.olga, NOW);
    expect(listed.members.find((m) => m.memberId === f.members.mojca)).toMatchObject({
      noLogin: true,
      invite: { expired: false },
    });
    expect(await getBusinessAccess(db, f.deskUsers.mojca)).toBeNull();

    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Mojca", password: PASSWORD }, NOW);

    const view = (await listMembers(db, f.a)).find((m) => m.memberId === f.members.mojca);
    expect(view).toMatchObject({ deskOnly: false, userId: f.deskUsers.mojca, displayName: "Mojca" });
    const after = await listWorkers(db, f.users.olga, NOW);
    expect(after.members.find((m) => m.memberId === f.members.mojca)).toMatchObject({
      noLogin: false,
      invite: null,
      status: "ACTIVE",
    });
    expect(after.invites).toEqual([]);
    expect(await getBusinessAccess(db, f.deskUsers.mojca)).toEqual({
      businessId: f.a,
      memberId: f.members.mojca,
      userId: f.deskUsers.mojca,
      role: FlowkoBusinessRole.WORKER,
    });
    expect(await readInviteForAcceptPage(db, token, NOW)).toEqual({ state: "invalid" });
  });

  it("the edited name changes User.name only (Open 8): the column label stays, no member-name check applies", async () => {
    const { token } = await inviteMojca();
    // „Lara“ is another member's label; the conversion writes no label, so it is no clash.
    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Lara", password: PASSWORD }, NOW);
    expect((await userRow(f.deskUsers.mojca)).name).toBe("Lara");
    expect(
      (await prismock.flowkoBusinessMember.findUniqueOrThrow({ where: { id: f.members.mojca } })).displayName
    ).toBe("Mojca");
  });

  it("an existing password row of the placeholder user is replaced (upsert), never a second one", async () => {
    await prismock.userPassword.create({ data: { userId: f.deskUsers.mojca, hash: "$2a$12$old" } });
    const { token } = await inviteMojca();
    const passwords = await prismock.userPassword.count();
    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Mojca", password: PASSWORD }, NOW);
    expect(await prismock.userPassword.count()).toBe(passwords);
    expect((await userRow(f.deskUsers.mojca)).password?.hash).toBe(HASH);
  });

  it("invalid (page) and invite_invalid (accept, no bcrypt, nothing written) when the member is LOCKED, the user is locked, already converted or gone", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      [
        "member LOCKED",
        () =>
          prismock.flowkoBusinessMember.update({
            where: { id: f.members.mojca },
            data: { status: FlowkoMemberStatus.LOCKED, lockedAt: NOW },
          }),
      ],
      [
        "user locked",
        () => prismock.user.update({ where: { id: f.deskUsers.mojca }, data: { locked: true } }),
      ],
      [
        "already converted (the e-mail is no desk e-mail)",
        () =>
          prismock.user.update({
            where: { id: f.deskUsers.mojca },
            data: { email: "mojca.prej@example.si" },
          }),
      ],
      ["member gone", () => prismock.flowkoBusinessMember.delete({ where: { id: f.members.mojca } })],
    ];
    for (const [label, breakIt] of cases) {
      vi.restoreAllMocks();
      insensitiveEmailShim();
      f = await setUp();
      const { token, inviteId } = await inviteMojca();
      await breakIt();
      expect(await readInviteForAcceptPage(db, token, NOW), label).toEqual({ state: "invalid" });
      const before = await counts();
      const userBefore = await prismock.user.findFirst({
        where: { id: f.deskUsers.mojca, OR: [{ locked: false }, { locked: true }] },
      });
      const hashPassword = hasher();
      expect(
        await codeOf(acceptInvite({ db, hashPassword }, { token, name: "Mojca", password: PASSWORD }, NOW)),
        label
      ).toBe("invite_invalid");
      expect(hashPassword, label).not.toHaveBeenCalled();
      expect(await counts(), label).toEqual(before);
      expect(
        await prismock.user.findFirst({
          where: { id: f.deskUsers.mojca, OR: [{ locked: false }, { locked: true }] },
        }),
        label
      ).toEqual(userBefore);
      expect(
        (await prismock.flowkoBusinessInvite.findUnique({ where: { id: inviteId } }))?.usedAt ?? null,
        label
      ).toBeNull();
    }
  });

  it("is single use: a second accept is invite_invalid without bcrypt; a rotated token is invite_invalid", async () => {
    const { token, inviteId } = await inviteMojca();
    const { resendInvite } = await import("./invites");
    const rotated = await resendInvite(inviteDeps(), f.users.olga, { inviteId, sendMail: false }, NOW);
    const hashPassword = hasher();
    expect(
      await codeOf(acceptInvite({ db, hashPassword }, { token, name: "Mojca", password: PASSWORD }, NOW))
    ).toBe("invite_invalid");
    expect(hashPassword).not.toHaveBeenCalled();

    const fresh = tokenOf(rotated.link);
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: fresh, name: "Mojca", password: PASSWORD },
      NOW
    );
    const before = await counts();
    const again = hasher();
    expect(
      await codeOf(
        acceptInvite({ db, hashPassword: again }, { token: fresh, name: "Mojca", password: PASSWORD }, NOW)
      )
    ).toBe("invite_invalid");
    expect(again).not.toHaveBeenCalled();
    expect(await counts()).toEqual(before);
  });

  it("C6 inside the conversion: the e-mail meanwhile has a (locked) user or a secondary e-mail -> email_has_login, the user stays desk-only", async () => {
    for (const [mail, claim] of [
      [
        "mojca.a@example.si",
        () =>
          prismock.user.create({
            data: { email: "MOJCA.A@example.si", username: "mojca-a", name: "X", locked: true },
          }),
      ],
      [
        "mojca.b@example.si",
        async () =>
          prismock.secondaryEmail.create({
            data: { userId: await makeUser("Druga"), email: "Mojca.B@Example.SI" },
          }),
      ],
    ] as const) {
      vi.restoreAllMocks();
      insensitiveEmailShim();
      f = await setUp();
      const { token, inviteId } = await inviteMojca(mail);
      await claim();
      const userBefore = await userRow(f.deskUsers.mojca);
      const before = await counts();
      expect(
        await codeOf(
          acceptInvite({ db, hashPassword: hasher() }, { token, name: "Mojca", password: PASSWORD }, NOW)
        )
      ).toBe("email_has_login");
      expect(await userRow(f.deskUsers.mojca)).toEqual(userBefore);
      expect(await counts()).toEqual(before);
      expect(
        (await prismock.flowkoBusinessInvite.findUniqueOrThrow({ where: { id: inviteId } })).usedAt
      ).toBeNull();
    }
  });

  it("the name rules: empty or 81 characters is bad_member before bcrypt", async () => {
    const { token } = await inviteMojca();
    const hashPassword = hasher();
    for (const name of ["", "   ", "x".repeat(81)]) {
      expect(await codeOf(acceptInvite({ db, hashPassword }, { token, name, password: PASSWORD }, NOW))).toBe(
        "bad_member"
      );
    }
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("a users e-mail P2002 on the update is email_has_login; P2028 and a raw 40P01 are member_conflict", async () => {
    const known = (code: string, meta: Record<string, unknown> = {}) =>
      new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: "6", meta });
    const failures: Array<[Prisma.PrismaClientKnownRequestError, string]> = [
      [
        known("P2002", {
          modelName: "User",
          driverAdapterError: { cause: { constraint: { fields: ["email"] } } },
        }),
        "email_has_login",
      ],
      [known("P2028"), "member_conflict"],
      [known("P2010", { driverAdapterError: { cause: { originalCode: "40P01" } } }), "member_conflict"],
    ];
    for (const [failure, code] of failures) {
      vi.restoreAllMocks();
      insensitiveEmailShim();
      f = await setUp();
      const { token } = await inviteMojca();
      vi.spyOn(prismock.user, "update").mockRejectedValueOnce(failure);
      expect(
        await codeOf(
          acceptInvite({ db, hashPassword: hasher() }, { token, name: "Mojca", password: PASSWORD }, NOW)
        )
      ).toBe(code);
    }
  });

  it("creates no user, member, Team, Membership, Profile, Host, Schedule, VerificationToken or service row", async () => {
    const { token } = await inviteMojca();
    const before = await counts();
    await acceptInvite({ db, hashPassword: hasher() }, { token, name: "Mojca", password: PASSWORD }, NOW);
    expect(await counts()).toEqual({ ...before, passwords: before.passwords + 1 });
  });

  it("a brand-new invite and a member invite of one business are each taken by their own path", async () => {
    const member = await inviteMojca();
    const fresh = await invite("WORKER", "nova@example.si", "Nova");
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: member.token, name: "Mojca", password: PASSWORD },
      NOW
    );
    await acceptInvite(
      { db, hashPassword: hasher() },
      { token: fresh.token, name: "Nova", password: PASSWORD },
      NOW
    );
    expect(
      await prismock.flowkoBusinessMember.count({ where: { businessId: f.a, displayName: "Nova" } })
    ).toBe(1);
    expect((await userRow(f.deskUsers.mojca)).email).toBe("mojca@example.si");
  });
});
