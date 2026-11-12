// Flowko U29d: the owner's invite service on prismock (I1–I9). Business A (owner Olga; login worker Ana; login
// staff Rok; desk-only workers Mojca and Lara (LOCKED); staff Sara without a login) and B (owner Zala; desk-only
// Bea). NOW = 2026-11-16T07:07:00Z (Mon 08:07 in Ljubljana); one DST case. `sendInvite` and `baseUrl` are stubs.
// Covers: create (both kinds), the e-mail rule, C6, the name rule, one open invite per e-mail and per member,
// expiry, resend and new link (same row, new hash), revoke, rights (owner only, foreign = forbidden), the mail
// outcome mapping (only "sent" is sent; nothing about it in a log line), the P2002 matcher in both shapes, and
// what workers.list answers about invites (no token, hash or creator; no e-mail on member rows). Locks, CHECKs,
// partial uniques and real races: invites.integration-test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; invites.ts takes `db` and never imports it.
import "@calcom/prisma";
import { MailTransportError, type MailSendOutcome } from "@calcom/emails/templates/_base-email";
import { INVITE_TTL_MS } from "@calcom/lib/flowkoBusiness/invites";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, addStaffWithoutLogin, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { hashInviteToken } from "./inviteToken";
import {
  createInvite,
  emailHasFlowkoLogin,
  type InviteDeps,
  type InviteMailArgs,
  inviteUniqueConflictCode,
  resendInvite,
  revokeInvite,
} from "./invites";
import { listWorkers } from "./workers";

const logged = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@calcom/lib/logger", () => {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      logged.calls.push([level, ...args]);
    };
  const sub = {
    silly: record("silly"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  return { default: { ...sub, getSubLogger: () => sub } };
});

const db = prismock as unknown as FlowkoDb;
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const BASE = "https://booking.example";
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: {
      email: `${name.toLowerCase()}${seq}@example.com`,
      username: `${name.toLowerCase()}${seq}`,
      name,
    },
    select: { id: true },
  });
  return user.id;
}

type Fixture = {
  a: number;
  b: number;
  users: Record<"olga" | "ana" | "rok" | "zala", number>;
  members: Record<"olga" | "ana" | "rok" | "mojca" | "lara" | "sara" | "zala" | "bea", number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Frizerstvo & Co",
    slug: `salon-a-${seq}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
  });
  const a = created.businessId;
  await prismock.flowkoBusiness.update({
    where: { id: a },
    data: { email: "salon@example.si" },
  });
  const ana = await makeUser("Ana");
  const rok = await makeUser("Rok");
  const anaMember = await addLoginMember(db, a, ana, FlowkoBusinessRole.WORKER);
  const rokMember = await addLoginMember(db, a, rok, FlowkoBusinessRole.STAFF);
  const mojca = await createDeskOnlyWorker(db, a, "Mojca");
  const lara = await createDeskOnlyWorker(db, a, "Lara");
  await prismock.flowkoBusinessMember.update({
    where: { id: lara.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  const sara = (await addStaffWithoutLogin(db, a, "Sara")) as {
    memberId: number;
  };

  const zala = await makeUser("Zala");
  const createdB = await createBusiness(db, {
    ownerUserId: zala,
    name: "Salon B",
    slug: `salon-b-${seq}`,
    templateId: "hair-salon",
    phone: "02 345 67 89",
  });
  const bea = await createDeskOnlyWorker(db, createdB.businessId, "Bea");
  return {
    a,
    b: createdB.businessId,
    users: { olga, ana, rok, zala },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      rok: rokMember.memberId,
      mojca: mojca.memberId,
      lara: lara.memberId,
      sara: sara.memberId,
      zala: createdB.ownerMemberId,
      bea: bea.memberId,
    },
  };
}

type Outcome = MailSendOutcome | Error;
function mailer(outcome: Outcome = "sent") {
  const sent: InviteMailArgs[] = [];
  const sendInvite = vi.fn(async (args: InviteMailArgs): Promise<MailSendOutcome> => {
    sent.push(args);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const deps: InviteDeps = { db, baseUrl: BASE, sendInvite };
  return { deps, sendInvite, sent };
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

const tokenOf = (link: string) => link.slice(`${BASE}/auth/pridruzi/`.length);
const inviteRows = () => prismock.flowkoBusinessInvite.findMany({ orderBy: { id: "asc" } });

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

// prismock treats an object filter on a field with a single-column @@unique (User.email, SecondaryEmail.email) as a
// composite-key lookup and never matches it (`match.js` uniqueFields branch), so `{ equals, mode: "insensitive" }`
// finds nothing there. This shim answers exactly that query shape the way Postgres does (case-insensitive equality,
// the rest of the where unchanged); every other findFirst passes through. The real query runs on Postgres in
// invites.integration-test.ts ("C6 on Postgres").
function insensitiveEmailShim() {
  for (const model of [prismock.user, prismock.secondaryEmail] as unknown as Array<{
    findFirst: (args?: { where?: Record<string, unknown> }) => Promise<unknown>;
    findMany: (args?: { where?: Record<string, unknown> }) => Promise<Array<{ id: number; email: string }>>;
  }>) {
    const original = model.findFirst.bind(model);
    vi.spyOn(model, "findFirst").mockImplementation(async (args) => {
      const filter = args?.where?.email as { equals?: unknown; mode?: unknown } | undefined;
      if (
        !filter ||
        typeof filter !== "object" ||
        filter.mode !== "insensitive" ||
        typeof filter.equals !== "string"
      )
        return original(args);
      const { email: _email, ...rest } = args?.where ?? {};
      const wanted = filter.equals.toLowerCase();
      const hit = (await model.findMany({ where: rest })).find((row) => row.email.toLowerCase() === wanted);
      return hit ? { id: hit.id } : null;
    });
  }
}

let f: Fixture;
beforeEach(async () => {
  logged.calls.length = 0;
  insensitiveEmailShim();
  f = await setUp();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const newAna = {
  kind: "new" as const,
  name: "  Hana  ",
  email: " Hana@Example.SI ",
  role: "WORKER" as const,
};

describe("createInvite, a brand-new person (I3)", () => {
  it("stores the trimmed name, the lower-cased e-mail, the hash only, expiry NOW + 7 d and the actor", async () => {
    const { deps } = mailer();
    const answer = await createInvite(deps, f.users.olga, newAna, NOW);
    const rows = await inviteRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      businessId: f.a,
      email: "hana@example.si",
      name: "Hana",
      role: FlowkoBusinessRole.WORKER,
      memberId: null,
      usedAt: null,
      revokedAt: null,
      createdByUserId: f.users.olga,
    });
    expect(row.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect(INVITE_TTL_MS).toBe(7 * DAY);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(answer.link.startsWith(`${BASE}/auth/pridruzi/`)).toBe(true);
    const token = tokenOf(answer.link);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.tokenHash).not.toBe(token);
    expect(hashInviteToken(token)).toBe(row.tokenHash);
    expect(answer).toEqual({
      inviteId: row.id,
      link: answer.link,
      mail: "sent",
      expiresDate: "2026-11-23",
      expiresTime: "08:07",
    });
    expect(JSON.stringify(answer)).not.toContain(row.tokenHash);
  });

  it("STAFF is stored as STAFF (C5)", async () => {
    const { deps } = mailer();
    await createInvite(deps, f.users.olga, { ...newAna, role: "STAFF" }, NOW);
    expect((await inviteRows())[0].role).toBe(FlowkoBusinessRole.STAFF);
  });

  it("refuses OWNER and any other role as bad_member, nothing written", async () => {
    const { deps, sendInvite } = mailer();
    const owner = { ...newAna, role: "OWNER" } as unknown as typeof newAna;
    expect(await codeOf(createInvite(deps, f.users.olga, owner, NOW))).toBe("bad_member");
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("shows the expiry in business-local time across the DST change (instant unchanged, wall time +1 h)", async () => {
    const { deps, sent } = mailer();
    const created = new Date("2027-03-25T07:07:00Z"); // Thu 08:07 CET
    const answer = await createInvite(deps, f.users.olga, newAna, created);
    const row = (await inviteRows())[0];
    expect(row.expiresAt.toISOString()).toBe("2027-04-01T07:07:00.000Z");
    expect(answer).toMatchObject({
      expiresDate: "2027-04-01",
      expiresTime: "09:07",
    });
    expect(sent[0]).toMatchObject({
      expiresDate: "čet., 1. 4. 2027",
      expiresTime: "09:07",
    });
  });

  it("sends the mail once, after the commit, with the raw business name, the Reply-To and the Slovene date", async () => {
    const order: string[] = [];
    const realTx = prismock.$transaction.bind(prismock);
    const spy = vi.spyOn(prismock, "$transaction").mockImplementation((async (arg: unknown) => {
      const result = await (realTx as (a: unknown) => Promise<unknown>)(arg);
      order.push("commit");
      return result;
    }) as never);
    const { deps, sendInvite, sent } = mailer();
    sendInvite.mockImplementation(async (args: InviteMailArgs) => {
      order.push("mail");
      sent.push(args);
      return "sent";
    });
    const answer = await createInvite(deps, f.users.olga, newAna, NOW);
    spy.mockRestore();
    expect(order).toEqual(["commit", "mail"]);
    expect(sendInvite).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({
      to: "hana@example.si",
      name: "Hana",
      businessName: "Frizerstvo & Co",
      replyTo: "salon@example.si",
      link: answer.link,
      expiresDate: "pon., 23. 11. 2026",
      expiresTime: "08:07",
    });
  });

  it("passes replyTo null when the business has no e-mail (no fallback, David 12 Nov)", async () => {
    await prismock.flowkoBusiness.update({
      where: { id: f.a },
      data: { email: null },
    });
    const { deps, sent } = mailer();
    await createInvite(deps, f.users.olga, newAna, NOW);
    expect(sent[0].replyTo).toBeNull();
  });

  it.each([
    ["skipped_kill_switch" as const],
    ["skipped_faux" as const],
    ["skipped_test_mode" as const],
    ["skipped_locked" as const],
  ])("answers mail not_sent for %s; the row stays; the log line names the outcome only", async (outcome) => {
    const { deps } = mailer(outcome);
    const answer = await createInvite(deps, f.users.olga, newAna, NOW);
    expect(answer.mail).toBe("not_sent");
    expect(await inviteRows()).toHaveLength(1);
    const lines = logged.calls.filter((c) => JSON.stringify(c).includes("flowko_invite_mail_not_sent"));
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).toContain(outcome);
  });

  it("a thrown MailTransportError (or anything else) is mail not_sent, never a throw; no address or token logged", async () => {
    for (const failure of [new MailTransportError(new Error("ECONNRESET")), new TypeError("boom")]) {
      logged.calls.length = 0;
      await prismock.flowkoBusinessInvite.deleteMany({});
      const { deps } = mailer(failure);
      const answer = await createInvite(deps, f.users.olga, newAna, NOW);
      expect(answer.mail).toBe("not_sent");
      const row = (await inviteRows())[0];
      expect(row).toBeDefined();
      const text = JSON.stringify(logged.calls);
      expect(text).toContain("flowko_invite_mail_not_sent");
      expect(text).toContain(failure.name);
      expect(text).not.toContain("hana@example.si");
      expect(text).not.toContain(tokenOf(answer.link));
      expect(text).not.toContain(row.tokenHash);
      expect(text).not.toContain("ECONNRESET");
      expect(text).not.toContain("boom");
    }
  });

  it.each([
    ["the desk domain", "desk-1@flowko.invalid"],
    ["sms.cal.com", "x@sms.cal.com"],
    ["any .invalid", "a@b.invalid"],
    ["malformed", "hana.example.si"],
    ["255 characters", `${"a".repeat(64)}@${"b".repeat(187)}.si`],
  ])("refuses %s as invite_bad_email, nothing written, no mail", async (_label, email) => {
    const { deps, sendInvite } = mailer();
    expect(await codeOf(createInvite(deps, f.users.olga, { ...newAna, email }, NOW))).toBe(
      "invite_bad_email"
    );
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("C6: an e-mail that has a login (any case, locked too) or is a secondary e-mail is email_has_login", async () => {
    const userId = await makeUser("Login");
    await prismock.user.update({
      where: { id: userId },
      data: { email: "ANA@example.si" },
    });
    const locked = await makeUser("Locked");
    await prismock.user.update({
      where: { id: locked },
      data: { email: "zaklenjen@example.si", locked: true },
    });
    await prismock.secondaryEmail.create({
      data: { userId, email: "Druga@Example.si" },
    });
    const { deps, sendInvite } = mailer();
    for (const email of ["ana@example.si", " Ana@Example.SI", "ZAKLENJEN@example.si", "druga@example.si"]) {
      expect(await codeOf(createInvite(deps, f.users.olga, { ...newAna, email }, NOW))).toBe(
        "email_has_login"
      );
    }
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("emailHasFlowkoLogin: users (case-insensitive, locked included) and secondary e-mails; aliases are distinct", async () => {
    const userId = await makeUser("Alias");
    await prismock.user.update({
      where: { id: userId },
      data: { email: "david@example.si", locked: true },
    });
    await prismock.secondaryEmail.create({
      data: { userId, email: "second@example.si" },
    });
    const tx = prismock as unknown as Prisma.TransactionClient;
    expect(await emailHasFlowkoLogin(tx, "david@example.si")).toBe(true);
    expect(await emailHasFlowkoLogin(tx, "DAVID@EXAMPLE.SI")).toBe(true);
    expect(await emailHasFlowkoLogin(tx, "second@example.si")).toBe(true);
    expect(await emailHasFlowkoLogin(tx, "david+u29d-a@example.si")).toBe(false);
    expect(await emailHasFlowkoLogin(tx, "nobody@example.si")).toBe(false);
  });

  it("refuses a name used by any member (case and space variants) as member_name_taken; empty / 81 chars bad_member", async () => {
    const { deps, sendInvite } = mailer();
    for (const name of ["mojca", "  MOJCA ", "Lara", "sara"]) {
      expect(await codeOf(createInvite(deps, f.users.olga, { ...newAna, name }, NOW))).toBe(
        "member_name_taken"
      );
    }
    expect(await codeOf(createInvite(deps, f.users.olga, { ...newAna, name: "  " }, NOW))).toBe("bad_member");
    expect(await codeOf(createInvite(deps, f.users.olga, { ...newAna, name: "x".repeat(81) }, NOW))).toBe(
      "bad_member"
    );
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
    // The same name in another business is free; 80 characters is fine.
    expect(await codeOf(createInvite(deps, f.users.zala, { ...newAna, name: "Mojca" }, NOW))).toBe("ok");
    expect(
      await codeOf(
        createInvite(deps, f.users.olga, { ...newAna, name: "x".repeat(80), email: "x@example.si" }, NOW)
      )
    ).toBe("ok");
  });

  it("a pending invite does not reserve its name (Open 7)", async () => {
    const { deps } = mailer();
    await createInvite(deps, f.users.olga, newAna, NOW);
    expect(
      await codeOf(createInvite(deps, f.users.olga, { ...newAna, email: "hana2@example.si" }, NOW))
    ).toBe("ok");
  });

  it("I1: an open unexpired invite for the e-mail is invite_pending; an expired one is revoked and replaced", async () => {
    const { deps, sendInvite } = mailer();
    const first = await createInvite(deps, f.users.olga, newAna, NOW);
    expect(await codeOf(createInvite(deps, f.users.olga, { ...newAna, email: "HANA@example.si" }, NOW))).toBe(
      "invite_pending"
    );
    expect(sendInvite).toHaveBeenCalledTimes(1);
    // Exactly at the expiry instant the invite is expired (expiresAt > now is the only "valid").
    const later = new Date(NOW.getTime() + 7 * DAY);
    const second = await createInvite(deps, f.users.olga, newAna, later);
    const rows = await inviteRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: first.inviteId,
      revokedAt: later,
      usedAt: null,
    });
    expect(rows[1]).toMatchObject({
      id: second.inviteId,
      revokedAt: null,
      email: "hana@example.si",
    });
    // The same e-mail open in another business is allowed.
    expect(await codeOf(createInvite(deps, f.users.zala, newAna, NOW))).toBe("ok");
  });

  it("is the owner's: a worker, a staff member and a stranger are forbidden, nothing written, no mail", async () => {
    const { deps, sendInvite } = mailer();
    const stranger = await makeUser("Stranger");
    for (const actor of [f.users.ana, f.users.rok, stranger]) {
      expect(await codeOf(createInvite(deps, actor, newAna, NOW))).toBe("forbidden");
      expect(
        await codeOf(
          createInvite(deps, actor, { kind: "member", memberId: f.members.mojca, email: "m@x.si" }, NOW)
        )
      ).toBe("forbidden");
    }
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("always writes into the actor's own business", async () => {
    const { deps } = mailer();
    await createInvite(deps, f.users.zala, newAna, NOW);
    expect((await inviteRows())[0].businessId).toBe(f.b);
  });
});

describe("createInvite, a desk-only member (C9)", () => {
  const forMojca = (email = "Mojca@Example.si") => ({
    kind: "member" as const,
    memberId: f.members.mojca,
    email,
  });

  it("links the member; role WORKER; the stored name is the member's displayName", async () => {
    const { deps, sent } = mailer();
    const answer = await createInvite(deps, f.users.olga, forMojca(), NOW);
    const row = (await inviteRows())[0];
    expect(row).toMatchObject({
      id: answer.inviteId,
      memberId: f.members.mojca,
      role: FlowkoBusinessRole.WORKER,
      name: "Mojca",
      email: "mojca@example.si",
    });
    expect(sent[0]).toMatchObject({ to: "mojca@example.si", name: "Mojca" });
  });

  it("refuses a login worker, a login staff, staff without a login and a LOCKED desk-only member", async () => {
    const { deps, sendInvite } = mailer();
    for (const memberId of [f.members.ana, f.members.rok, f.members.sara, f.members.lara, f.members.olga]) {
      expect(
        await codeOf(
          createInvite(deps, f.users.olga, { kind: "member", memberId, email: "m@example.si" }, NOW)
        )
      ).toBe("member_not_desk_only");
    }
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("a foreign or missing member is forbidden (Review Focus 5), even with an e-mail that has a login", async () => {
    const { deps, sendInvite } = mailer();
    const anaEmail = (await prismock.user.findUniqueOrThrow({ where: { id: f.users.ana } })).email;
    for (const memberId of [f.members.bea, 999_999]) {
      for (const email of ["m@example.si", anaEmail]) {
        expect(await codeOf(createInvite(deps, f.users.olga, { kind: "member", memberId, email }, NOW))).toBe(
          "forbidden"
        );
      }
    }
    expect(await inviteRows()).toHaveLength(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("I1: an open invite of the member blocks a second one (any e-mail); an expired one is revoked", async () => {
    const { deps } = mailer();
    const first = await createInvite(deps, f.users.olga, forMojca(), NOW);
    expect(await codeOf(createInvite(deps, f.users.olga, forMojca("other@example.si"), NOW))).toBe(
      "invite_pending"
    );
    const later = new Date(NOW.getTime() + 8 * DAY);
    await createInvite(deps, f.users.olga, forMojca("other@example.si"), later);
    const rows = await inviteRows();
    expect(rows.map((r) => [r.id === first.inviteId, r.revokedAt?.getTime() ?? null])).toEqual([
      [true, later.getTime()],
      [false, null],
    ]);
  });

  it("the e-mail rule and C6 apply to member invites too", async () => {
    const { deps } = mailer();
    const anaEmail = (await prismock.user.findUniqueOrThrow({ where: { id: f.users.ana } })).email;
    expect(await codeOf(createInvite(deps, f.users.olga, forMojca("x@flowko.invalid"), NOW))).toBe(
      "invite_bad_email"
    );
    expect(await codeOf(createInvite(deps, f.users.olga, forMojca(anaEmail.toUpperCase()), NOW))).toBe(
      "email_has_login"
    );
  });
});

describe("createInvite, P2002 and lock failures (mapped outside the transaction)", () => {
  const p2002 = (meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6",
      meta,
    });

  it("a parallel insert that hit a partial unique is invite_pending; another P2002 is rethrown", async () => {
    const { deps, sendInvite } = mailer();
    const adapterForm = p2002({
      modelName: "FlowkoBusinessInvite",
      driverAdapterError: {
        cause: { constraint: { fields: ['"businessId"', "email"] } },
      },
    });
    vi.spyOn(prismock.flowkoBusinessInvite, "create").mockRejectedValueOnce(adapterForm);
    expect(await codeOf(createInvite(deps, f.users.olga, newAna, NOW))).toBe("invite_pending");
    const other = p2002({
      modelName: "FlowkoBusinessInvite",
      target: ["tokenHash"],
    });
    vi.spyOn(prismock.flowkoBusinessInvite, "create").mockRejectedValueOnce(other);
    await expect(createInvite(deps, f.users.olga, newAna, NOW)).rejects.toBe(other);
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("a lost lock race (P2028, P2034, P2010 40P01) is member_conflict", async () => {
    const { deps } = mailer();
    const raw = (code: string, meta: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, {
        code,
        clientVersion: "6",
        meta,
      });
    for (const failure of [
      raw("P2028", {}),
      raw("P2034", {}),
      raw("P2010", {
        driverAdapterError: { cause: { originalCode: "40P01", code: "40P01" } },
      }),
    ]) {
      vi.spyOn(prismock.flowkoBusinessInvite, "create").mockRejectedValueOnce(failure);
      expect(await codeOf(createInvite(deps, f.users.olga, newAna, NOW))).toBe("member_conflict");
    }
  });
});

describe("inviteUniqueConflictCode (both P2002 shapes + modelName)", () => {
  const p2002 = (meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6",
      meta,
    });
  const adapter = (modelName: string, fields?: string[], index?: string) =>
    p2002({
      modelName,
      driverAdapterError: { cause: { constraint: { fields, index } } },
    });

  it("User email -> email_has_login (classic target, adapter fields, index name)", () => {
    expect(inviteUniqueConflictCode(p2002({ modelName: "User", target: ["email"] }))).toBe("email_has_login");
    expect(inviteUniqueConflictCode(adapter("User", ['"email"']))).toBe("email_has_login");
    expect(inviteUniqueConflictCode(p2002({ target: "users_email_key" }))).toBe("email_has_login");
    expect(inviteUniqueConflictCode(adapter("User", undefined, "users_email_key"))).toBe("email_has_login");
  });

  it("FlowkoBusinessInvite (businessId, email) or (memberId) -> invite_pending", () => {
    expect(inviteUniqueConflictCode(adapter("FlowkoBusinessInvite", ["businessId", "email"]))).toBe(
      "invite_pending"
    );
    expect(inviteUniqueConflictCode(adapter("FlowkoBusinessInvite", ['"memberId"']))).toBe("invite_pending");
    expect(inviteUniqueConflictCode(p2002({ target: "FlowkoBusinessInvite_one_open_per_email" }))).toBe(
      "invite_pending"
    );
    expect(
      inviteUniqueConflictCode(
        adapter("FlowkoBusinessInvite", undefined, "FlowkoBusinessInvite_one_open_per_member")
      )
    ).toBe("invite_pending");
  });

  it("anything else -> null", () => {
    expect(inviteUniqueConflictCode(adapter("FlowkoBusinessInvite", ["tokenHash"]))).toBeNull();
    expect(inviteUniqueConflictCode(adapter("User", ["username"]))).toBeNull();
    expect(inviteUniqueConflictCode(adapter("SecondaryEmail", ["email"]))).toBeNull();
    expect(inviteUniqueConflictCode(adapter("FlowkoBusinessMember", ["memberId"]))).toBeNull();
    expect(inviteUniqueConflictCode(p2002({}))).toBeNull();
    expect(
      inviteUniqueConflictCode(
        new Prisma.PrismaClientKnownRequestError("x", {
          code: "P2003",
          clientVersion: "6",
          meta: { target: ["email"] },
        })
      )
    ).toBeNull();
    expect(inviteUniqueConflictCode(new Error("email"))).toBeNull();
  });
});

describe("resendInvite and new link (I6)", () => {
  async function created(deps: InviteDeps) {
    const answer = await createInvite(deps, f.users.olga, newAna, NOW);
    const row = await prismock.flowkoBusinessInvite.findUniqueOrThrow({
      where: { id: answer.inviteId },
    });
    return { answer, row };
  }

  it("rotates the same row: new hash, expiry from the resend; the old hash is gone; mails again", async () => {
    const { deps, sendInvite, sent } = mailer();
    const { answer: first, row: before } = await created(deps);
    const at = new Date(NOW.getTime() + 2 * DAY);
    const answer = await resendInvite(deps, f.users.olga, { inviteId: first.inviteId, sendMail: true }, at);
    const rows = await inviteRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.inviteId);
    expect(rows[0].tokenHash).not.toBe(before.tokenHash);
    expect(rows[0].expiresAt.getTime()).toBe(at.getTime() + 7 * DAY);
    expect(hashInviteToken(tokenOf(answer.link))).toBe(rows[0].tokenHash);
    expect(answer.link).not.toBe(first.link);
    expect(
      await prismock.flowkoBusinessInvite.findUnique({
        where: { tokenHash: before.tokenHash },
      })
    ).toBeNull();
    expect(answer).toEqual({
      inviteId: first.inviteId,
      link: answer.link,
      mail: "sent",
      expiresDate: "2026-11-25",
      expiresTime: "08:07",
    });
    expect(sendInvite).toHaveBeenCalledTimes(2);
    expect(sent[1]).toMatchObject({
      to: "hana@example.si",
      link: answer.link,
      expiresDate: "sre., 25. 11. 2026",
    });
  });

  it("sendMail false = a new link without a mail (mail skipped)", async () => {
    const { deps, sendInvite } = mailer();
    const { answer: first } = await created(deps);
    const answer = await resendInvite(deps, f.users.olga, { inviteId: first.inviteId, sendMail: false }, NOW);
    expect(answer.mail).toBe("skipped");
    expect(sendInvite).toHaveBeenCalledTimes(1);
    expect(hashInviteToken(tokenOf(answer.link))).toBe((await inviteRows())[0].tokenHash);
  });

  it("an expired open invite may be resent", async () => {
    const { deps } = mailer();
    const { answer: first } = await created(deps);
    const later = new Date(NOW.getTime() + 30 * DAY);
    const answer = await resendInvite(
      deps,
      f.users.olga,
      { inviteId: first.inviteId, sendMail: false },
      later
    );
    expect((await inviteRows())[0].expiresAt.getTime()).toBe(later.getTime() + 7 * DAY);
    expect(answer.inviteId).toBe(first.inviteId);
  });

  it("a used or revoked invite is invite_gone, nothing changed", async () => {
    const { deps } = mailer();
    const { answer: first } = await created(deps);
    await prismock.flowkoBusinessInvite.update({
      where: { id: first.inviteId },
      data: { usedAt: NOW },
    });
    const usedRow = (await inviteRows())[0];
    expect(
      await codeOf(resendInvite(deps, f.users.olga, { inviteId: first.inviteId, sendMail: true }, NOW))
    ).toBe("invite_gone");
    expect((await inviteRows())[0]).toEqual(usedRow);
    await prismock.flowkoBusinessInvite.update({
      where: { id: first.inviteId },
      data: { usedAt: null, revokedAt: NOW },
    });
    expect(
      await codeOf(resendInvite(deps, f.users.olga, { inviteId: first.inviteId, sendMail: false }, NOW))
    ).toBe("invite_gone");
  });

  it("a foreign or missing invite and a non-owner actor are forbidden, nothing changed, no mail", async () => {
    const { deps, sendInvite } = mailer();
    const { answer: first, row } = await created(deps);
    for (const actor of [f.users.zala, f.users.ana, f.users.rok]) {
      expect(await codeOf(resendInvite(deps, actor, { inviteId: first.inviteId, sendMail: true }, NOW))).toBe(
        "forbidden"
      );
    }
    expect(await codeOf(resendInvite(deps, f.users.olga, { inviteId: 999_999, sendMail: true }, NOW))).toBe(
      "forbidden"
    );
    expect((await inviteRows())[0]).toEqual(row);
    expect(sendInvite).toHaveBeenCalledTimes(1);
  });

  it("C6 again: the e-mail meanwhile has a login -> email_has_login, the old link stays", async () => {
    const { deps } = mailer();
    const { answer: first, row } = await created(deps);
    const userId = await makeUser("Late");
    await prismock.user.update({
      where: { id: userId },
      data: { email: "hana@example.si" },
    });
    expect(
      await codeOf(resendInvite(deps, f.users.olga, { inviteId: first.inviteId, sendMail: true }, NOW))
    ).toBe("email_has_login");
    expect((await inviteRows())[0]).toEqual(row);
  });

  it("a member invite: the member must still be an ACTIVE desk-only WORKER, else member_not_desk_only", async () => {
    const { deps } = mailer();
    const answer = await createInvite(
      deps,
      f.users.olga,
      { kind: "member", memberId: f.members.mojca, email: "mojca@example.si" },
      NOW
    );
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.mojca },
      data: { status: FlowkoMemberStatus.LOCKED },
    });
    expect(
      await codeOf(resendInvite(deps, f.users.olga, { inviteId: answer.inviteId, sendMail: false }, NOW))
    ).toBe("member_not_desk_only");
    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.mojca },
      data: { status: FlowkoMemberStatus.ACTIVE },
    });
    const ok = await resendInvite(deps, f.users.olga, { inviteId: answer.inviteId, sendMail: false }, NOW);
    expect(ok.inviteId).toBe(answer.inviteId);
    // The desk user got a real e-mail by some other path: no longer desk-only.
    const mojca = await prismock.flowkoBusinessMember.findUniqueOrThrow({
      where: { id: f.members.mojca },
    });
    await prismock.user.update({
      where: { id: mojca.userId ?? 0 },
      data: { email: "real@example.si" },
    });
    expect(
      await codeOf(resendInvite(deps, f.users.olga, { inviteId: answer.inviteId, sendMail: false }, NOW))
    ).toBe("member_not_desk_only");
  });

  it("maps mail outcomes like create; a throw is not_sent", async () => {
    const { deps } = mailer(new MailTransportError(new Error("x")));
    const first = await createInvite(deps, f.users.olga, newAna, NOW);
    const answer = await resendInvite(deps, f.users.olga, { inviteId: first.inviteId, sendMail: true }, NOW);
    expect(answer.mail).toBe("not_sent");
  });
});

describe("revokeInvite (I7)", () => {
  it("sets revokedAt = NOW, keeps the row; a second revoke is invite_gone", async () => {
    const { deps, sendInvite } = mailer();
    const first = await createInvite(deps, f.users.olga, newAna, NOW);
    const at = new Date(NOW.getTime() + DAY);
    expect(await revokeInvite(db, f.users.olga, { inviteId: first.inviteId }, at)).toEqual({
      status: "revoked",
    });
    const row = (await inviteRows())[0];
    expect(row.revokedAt).toEqual(at);
    expect(row.usedAt).toBeNull();
    expect(await codeOf(revokeInvite(db, f.users.olga, { inviteId: first.inviteId }, at))).toBe(
      "invite_gone"
    );
    expect(sendInvite).toHaveBeenCalledTimes(1);
    // The e-mail is free again.
    expect(await codeOf(createInvite(deps, f.users.olga, newAna, at))).toBe("ok");
  });

  it("an expired open invite may be revoked; a used one is invite_gone", async () => {
    const { deps } = mailer();
    const first = await createInvite(deps, f.users.olga, newAna, NOW);
    const later = new Date(NOW.getTime() + 30 * DAY);
    expect(await codeOf(revokeInvite(db, f.users.olga, { inviteId: first.inviteId }, later))).toBe("ok");
    const second = await createInvite(deps, f.users.olga, newAna, later);
    await prismock.flowkoBusinessInvite.update({
      where: { id: second.inviteId },
      data: { usedAt: later },
    });
    expect(await codeOf(revokeInvite(db, f.users.olga, { inviteId: second.inviteId }, later))).toBe(
      "invite_gone"
    );
  });

  it("a foreign or missing invite and a non-owner actor are forbidden, nothing changed", async () => {
    const { deps } = mailer();
    const first = await createInvite(deps, f.users.olga, newAna, NOW);
    const row = (await inviteRows())[0];
    for (const actor of [f.users.zala, f.users.ana, f.users.rok]) {
      expect(await codeOf(revokeInvite(db, actor, { inviteId: first.inviteId }, NOW))).toBe("forbidden");
    }
    expect(await codeOf(revokeInvite(db, f.users.olga, { inviteId: 999_999 }, NOW))).toBe("forbidden");
    expect((await inviteRows())[0]).toEqual(row);
  });
});

describe("listWorkers with invites (I9)", () => {
  it("lists open brand-new invites in creation order and the open invite of a desk-only member; expired flagged", async () => {
    const { deps } = mailer();
    const hana = await createInvite(deps, f.users.olga, newAna, NOW);
    const iva = await createInvite(
      deps,
      f.users.olga,
      { kind: "new", name: "Iva", email: "iva@example.si", role: "STAFF" },
      new Date(NOW.getTime() - 8 * DAY)
    );
    const mojca = await createInvite(
      deps,
      f.users.olga,
      { kind: "member", memberId: f.members.mojca, email: "mojca@example.si" },
      NOW
    );
    // A used and a revoked one are not listed.
    const used = await createInvite(
      deps,
      f.users.olga,
      { kind: "new", name: "Used", email: "used@example.si", role: "WORKER" },
      NOW
    );
    await prismock.flowkoBusinessInvite.update({
      where: { id: used.inviteId },
      data: { usedAt: NOW },
    });
    const revoked = await createInvite(
      deps,
      f.users.olga,
      { kind: "new", name: "Gone", email: "gone@example.si", role: "WORKER" },
      NOW
    );
    await revokeInvite(db, f.users.olga, { inviteId: revoked.inviteId }, NOW);
    // Another business's invite never shows.
    await createInvite(deps, f.users.zala, { ...newAna, email: "b@example.si" }, NOW);

    const answer = await listWorkers(db, f.users.olga, NOW);
    expect(answer.invites).toEqual([
      {
        inviteId: hana.inviteId,
        name: "Hana",
        email: "hana@example.si",
        role: "WORKER",
        expiresDate: "2026-11-23",
        expiresTime: "08:07",
        expired: false,
      },
      {
        inviteId: iva.inviteId,
        name: "Iva",
        email: "iva@example.si",
        role: "STAFF",
        expiresDate: "2026-11-15",
        expiresTime: "08:07",
        expired: true,
      },
    ]);
    const byId = new Map(answer.members.map((m) => [m.memberId, m]));
    expect(byId.get(f.members.mojca)?.invite).toEqual({
      inviteId: mojca.inviteId,
      expiresDate: "2026-11-23",
      expiresTime: "08:07",
      expired: false,
    });
    for (const id of [f.members.olga, f.members.ana, f.members.lara, f.members.sara]) {
      expect(byId.get(id)?.invite).toBeNull();
    }
  });

  it("an invite is expired exactly at expiresAt", async () => {
    const { deps } = mailer();
    await createInvite(deps, f.users.olga, newAna, NOW);
    const at = new Date(NOW.getTime() + 7 * DAY);
    expect((await listWorkers(db, f.users.olga, at)).invites[0].expired).toBe(true);
    expect((await listWorkers(db, f.users.olga, new Date(at.getTime() - 1))).invites[0].expired).toBe(false);
  });

  it("no invites -> invites [] and every member's invite null", async () => {
    const answer = await listWorkers(db, f.users.olga, NOW);
    expect(answer.invites).toEqual([]);
    expect(answer.members.every((m) => m.invite === null)).toBe(true);
  });

  it("deep key scan: no token, hash, creator, uid, phone or user id; no e-mail on member rows", async () => {
    const { deps } = mailer();
    const hana = await createInvite(deps, f.users.olga, newAna, NOW);
    await createInvite(
      deps,
      f.users.olga,
      { kind: "member", memberId: f.members.mojca, email: "mojca@example.si" },
      NOW
    );
    const answer = await listWorkers(db, f.users.olga, NOW);
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
      "link",
    ]) {
      expect(all.has(banned)).toBe(false);
    }
    const json = JSON.stringify(answer);
    for (const row of await inviteRows()) expect(json).not.toContain(row.tokenHash);
    expect(json).not.toContain(tokenOf(hana.link));
    // Member rows: no e-mail key and no "@" anywhere, even with an invite.
    const memberKeys = keysDeep(answer.members);
    expect(memberKeys.has("email")).toBe(false);
    expect(JSON.stringify(answer.members)).not.toContain("@");
    // Pending invites: exactly these keys.
    expect([...keysDeep(answer.invites)].sort()).toEqual(
      ["email", "expired", "expiresDate", "expiresTime", "inviteId", "name", "role"].sort()
    );
  });
});
