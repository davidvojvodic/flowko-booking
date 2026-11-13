// @vitest-environment node
// Flowko U29d: the owner's invite service (I1–I9) on a real database (602 migrations): the rows the service writes
// pass every M1 CHECK; Review Focus 2 for the owner's side (parallel creates of one e-mail -> one invite_pending;
// resend vs revoke and revoke vs revoke on one row serialise on the invite row lock; resend vs create on an expired
// row never leaves two open invites); the real driver-adapter meta of the two partial-unique violations and the
// matcher that maps them (outside the transaction); create vs addDeskWorker with one name under the business row
// lock (a pending invite does not reserve its name, Open 7); C6 case-insensitive with a locked user and a
// secondary e-mail. Runs only with VITEST_MODE=integration against the throwaway DB.
// Flowko U29d final review SPEC-2: `_` in an address is no ILIKE wildcard at create and resend.
import prisma from "@calcom/prisma";
import type { MailSendOutcome } from "@calcom/emails/templates/_base-email";
import { Prisma } from "@calcom/prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { hashInviteToken } from "./inviteToken";
import {
  createInvite,
  type InviteDeps,
  type InviteMailArgs,
  inviteUniqueConflictCode,
  resendInvite,
  revokeInvite,
} from "./invites";
import { addDeskWorker, listWorkers } from "./workers";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const DAY = 86_400_000;
const BASE = "https://booking.example";

function mailer() {
  const sent: InviteMailArgs[] = [];
  const sendInvite = vi.fn(async (args: InviteMailArgs): Promise<MailSendOutcome> => {
    sent.push(args);
    return "sent";
  });
  const deps: InviteDeps = { db: prisma, baseUrl: BASE, sendInvite };
  return { deps, sendInvite, sent };
}

async function realUser(name: string, email?: string): Promise<number> {
  const username = `${name.toLowerCase()}-${RUN}`;
  const user = await prisma.user.create({
    data: {
      email: email ?? `${username}@example.com`,
      username,
      name,
      completedOnboarding: true,
    },
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

async function freshBusiness(label: string): Promise<{ owner: number; businessId: number }> {
  const owner = await realUser(`Own${label}`);
  const created = await createBusiness(prisma, {
    ownerUserId: owner,
    name: `Salon ${label} ${RUN}`,
    slug: `salon-${label.toLowerCase()}-${RUN}`,
    templateId: "hair-salon",
  });
  return { owner, businessId: created.businessId };
}

const email = (label: string) => `${label}-${RUN}@example.com`;
const p2002Of = async (promise: Promise<unknown>): Promise<Prisma.PrismaClientKnownRequestError> => {
  try {
    await promise;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return e;
    throw e;
  }
  throw new Error("expected a P2002");
};

let a: { owner: number; businessId: number };
beforeAll(async () => {
  a = await freshBusiness("Inv");
});

describe("U29d invite service on a real database", () => {
  it("create writes a row every M1 CHECK accepts; the link's hash is the stored hash; listWorkers shows it", async () => {
    const { deps } = mailer();
    const answer = await createInvite(
      deps,
      a.owner,
      {
        kind: "new",
        name: "  Hana  ",
        email: ` ${email("Hana").toUpperCase()} `,
        role: "STAFF",
      },
      NOW
    );
    const row = await prisma.flowkoBusinessInvite.findUniqueOrThrow({
      where: { id: answer.inviteId },
    });
    expect(row).toMatchObject({
      businessId: a.businessId,
      email: email("hana"),
      name: "Hana",
      role: "STAFF",
      memberId: null,
      usedAt: null,
      revokedAt: null,
      createdByUserId: a.owner,
    });
    expect(row.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect(hashInviteToken(answer.link.slice(`${BASE}/auth/pridruzi/`.length))).toBe(row.tokenHash);
    const listed = await listWorkers(prisma, a.owner, NOW);
    expect(listed.invites.find((i) => i.inviteId === answer.inviteId)).toEqual({
      inviteId: answer.inviteId,
      name: "Hana",
      email: email("hana"),
      role: "STAFF",
      expiresDate: "2026-11-23",
      expiresTime: "08:07",
      expired: false,
    });
  });

  it("a desk-only member's invite links the member; resend rotates the same row and the old hash is gone", async () => {
    const { deps } = mailer();
    const desk = await createDeskOnlyWorker(prisma, a.businessId, `Desk ${RUN}`);
    const first = await createInvite(
      deps,
      a.owner,
      { kind: "member", memberId: desk.memberId, email: email("desk") },
      NOW
    );
    const before = await prisma.flowkoBusinessInvite.findUniqueOrThrow({
      where: { id: first.inviteId },
    });
    expect(before).toMatchObject({
      memberId: desk.memberId,
      role: "WORKER",
      name: `Desk ${RUN}`,
    });
    const later = new Date(NOW.getTime() + DAY);
    const again = await resendInvite(deps, a.owner, { inviteId: first.inviteId, sendMail: false }, later);
    expect(again.mail).toBe("skipped");
    const after = await prisma.flowkoBusinessInvite.findUniqueOrThrow({
      where: { id: first.inviteId },
    });
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBe(later.getTime() + 7 * DAY);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(
      await prisma.flowkoBusinessInvite.findUnique({
        where: { tokenHash: before.tokenHash },
      })
    ).toBeNull();
    const listed = await listWorkers(prisma, a.owner, later);
    expect(listed.members.find((m) => m.memberId === desk.memberId)?.invite).toMatchObject({
      inviteId: first.inviteId,
      expired: false,
    });
    expect(listed.invites.some((i) => i.inviteId === first.inviteId)).toBe(false);
  });

  it("the real adapter meta of both partial-unique violations, and the matcher maps each to invite_pending", async () => {
    const desk = await createDeskOnlyWorker(prisma, a.businessId, `Meta ${RUN}`);
    const base = {
      businessId: a.businessId,
      name: "Meta",
      role: "WORKER" as const,
      expiresAt: new Date(NOW.getTime() + DAY),
    };
    await prisma.flowkoBusinessInvite.create({
      data: { ...base, email: email("meta"), tokenHash: "1".repeat(64) },
    });
    const byEmail = await p2002Of(
      prisma.flowkoBusinessInvite.create({
        data: { ...base, email: email("meta"), tokenHash: "2".repeat(64) },
      })
    );
    await prisma.flowkoBusinessInvite.create({
      data: {
        ...base,
        email: email("meta-m1"),
        memberId: desk.memberId,
        tokenHash: "3".repeat(64),
      },
    });
    const byMember = await p2002Of(
      prisma.flowkoBusinessInvite.create({
        data: {
          ...base,
          email: email("meta-m2"),
          memberId: desk.memberId,
          tokenHash: "4".repeat(64),
        },
      })
    );
    const shape = (e: Prisma.PrismaClientKnownRequestError) => {
      const meta = (e.meta ?? {}) as {
        modelName?: unknown;
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: unknown; kind?: unknown };
        };
      };
      return {
        modelName: meta.modelName,
        target: meta.target,
        constraint: meta.driverAdapterError?.cause?.constraint,
        kind: meta.driverAdapterError?.cause?.kind,
      };
    };
    // The shape production sees (pg driver adapter): the column list parsed from the Postgres detail (a quoted
    // identifier keeps its quotes), no index name, no classic `target`.
    const adapterShape = (fields: string[]) => ({
      modelName: "FlowkoBusinessInvite",
      target: undefined,
      constraint: { fields },
      kind: "UniqueConstraintViolation",
    });
    expect(shape(byEmail)).toEqual(adapterShape(['"businessId"', "email"]));
    expect(shape(byMember)).toEqual(adapterShape(['"memberId"']));
    expect(inviteUniqueConflictCode(byEmail)).toBe("invite_pending");
    expect(inviteUniqueConflictCode(byMember)).toBe("invite_pending");
    // A users e-mail violation is email_has_login (Task 3 relies on it; asserted here once with the real shape).
    await realUser("MetaUser", email("meta-user"));
    const byUser = await p2002Of(
      prisma.user.create({
        data: { email: email("meta-user"), username: `meta-user2-${RUN}` },
      })
    );
    expect(shape(byUser)).toEqual({
      modelName: "User",
      target: undefined,
      constraint: { fields: ["email"] },
      kind: "UniqueConstraintViolation",
    });
    expect(inviteUniqueConflictCode(byUser)).toBe("email_has_login");
    // The tokenHash unique is not a "pending" conflict.
    const byToken = await p2002Of(
      prisma.flowkoBusinessInvite.create({
        data: { ...base, email: email("meta-t"), tokenHash: "1".repeat(64) },
      })
    );
    expect(inviteUniqueConflictCode(byToken)).toBeNull();
  });

  it("a P2002 inside the service's transaction (open-row check bypassed) is invite_pending, mapped outside it", async () => {
    const { deps, sendInvite } = mailer();
    await createInvite(
      deps,
      a.owner,
      { kind: "new", name: "Bypass", email: email("bypass"), role: "WORKER" },
      NOW
    );
    // The open-row read answers "nothing open", so the insert itself hits FlowkoBusinessInvite_one_open_per_email.
    const blind = (tx: Prisma.TransactionClient) =>
      new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop !== "flowkoBusinessInvite") return value;
          return new Proxy(value as object, {
            get(model, method, r) {
              if (method === "findMany") return async () => [];
              return Reflect.get(model, method, r);
            },
          });
        },
      });
    const bypass = {
      $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        prisma.$transaction((tx) => fn(blind(tx))),
    } as unknown as FlowkoDb;
    expect(
      await codeOf(
        createInvite(
          { ...deps, db: bypass },
          a.owner,
          {
            kind: "new",
            name: "Bypass",
            email: email("bypass"),
            role: "WORKER",
          },
          NOW
        )
      )
    ).toBe("invite_pending");
    expect(sendInvite).toHaveBeenCalledTimes(1);
    expect(
      await prisma.flowkoBusinessInvite.count({
        where: { businessId: a.businessId, email: email("bypass") },
      })
    ).toBe(1);
  });

  it("Review Focus 2: parallel creates of one e-mail -> exactly one invite_pending (20 rounds)", async () => {
    const { deps } = mailer();
    for (let round = 0; round < 20; round++) {
      const target = email(`par${round}`);
      const codes = await Promise.all([
        codeOf(
          createInvite(deps, a.owner, { kind: "new", name: `P${round}`, email: target, role: "WORKER" }, NOW)
        ),
        codeOf(
          createInvite(
            deps,
            a.owner,
            {
              kind: "new",
              name: `Q${round}`,
              email: target.toUpperCase(),
              role: "STAFF",
            },
            NOW
          )
        ),
      ]);
      expect(codes.sort()).toEqual(["invite_pending", "ok"]);
      expect(
        await prisma.flowkoBusinessInvite.count({
          where: {
            businessId: a.businessId,
            email: target,
            usedAt: null,
            revokedAt: null,
          },
        })
      ).toBe(1);
    }
  });

  it("Review Focus 2: parallel creates for one desk-only member (two e-mails) -> exactly one invite_pending (10 rounds)", async () => {
    const { deps } = mailer();
    for (let round = 0; round < 10; round++) {
      const desk = await createDeskOnlyWorker(prisma, a.businessId, `Pm${round} ${RUN}`);
      const codes = await Promise.all([
        codeOf(
          createInvite(
            deps,
            a.owner,
            {
              kind: "member",
              memberId: desk.memberId,
              email: email(`pm${round}a`),
            },
            NOW
          )
        ),
        codeOf(
          createInvite(
            deps,
            a.owner,
            {
              kind: "member",
              memberId: desk.memberId,
              email: email(`pm${round}b`),
            },
            NOW
          )
        ),
      ]);
      expect(codes.sort()).toEqual(["invite_pending", "ok"]);
      expect(
        await prisma.flowkoBusinessInvite.count({
          where: { memberId: desk.memberId, usedAt: null, revokedAt: null },
        })
      ).toBe(1);
    }
  });

  it("revoke vs revoke on one row -> one revoked, the other invite_gone (20 rounds)", async () => {
    const { deps } = mailer();
    for (let round = 0; round < 20; round++) {
      const { inviteId } = await createInvite(
        deps,
        a.owner,
        {
          kind: "new",
          name: `R${round}`,
          email: email(`rr${round}`),
          role: "WORKER",
        },
        NOW
      );
      const codes = await Promise.all([
        codeOf(revokeInvite(prisma, a.owner, { inviteId }, NOW)),
        codeOf(revokeInvite(prisma, a.owner, { inviteId }, NOW)),
      ]);
      expect(codes.sort()).toEqual(["invite_gone", "ok"]);
    }
  });

  it("resend vs revoke on one row serialise on the row lock: revoke always wins the end state (20 rounds)", async () => {
    const { deps } = mailer();
    for (let round = 0; round < 20; round++) {
      const { inviteId } = await createInvite(
        deps,
        a.owner,
        {
          kind: "new",
          name: `S${round}`,
          email: email(`rs${round}`),
          role: "WORKER",
        },
        NOW
      );
      const original = (
        await prisma.flowkoBusinessInvite.findUniqueOrThrow({
          where: { id: inviteId },
        })
      ).tokenHash;
      let resentHash: string | null = null;
      const [resendCode, revokeCode] = await Promise.all([
        codeOf(
          resendInvite(deps, a.owner, { inviteId, sendMail: false }, NOW).then((answer) => {
            resentHash = hashInviteToken(answer.link.slice(`${BASE}/auth/pridruzi/`.length));
          })
        ),
        codeOf(revokeInvite(prisma, a.owner, { inviteId }, NOW)),
      ]);
      // Revoke never loses: either it ran first (resend answers invite_gone, the hash is the original) or second
      // (it revokes the rotated row). Never a live link after both.
      expect(revokeCode).toBe("ok");
      expect(["ok", "invite_gone"]).toContain(resendCode);
      const row = await prisma.flowkoBusinessInvite.findUniqueOrThrow({
        where: { id: inviteId },
      });
      expect(row.revokedAt).not.toBeNull();
      expect(row.tokenHash).toBe(resendCode === "ok" ? resentHash : original);
    }
  });

  it("resend vs create on an EXPIRED row never leaves two open invites for the e-mail (20 rounds)", async () => {
    const { deps } = mailer();
    const later = new Date(NOW.getTime() + 8 * DAY); // every row created at NOW has expired by then
    for (let round = 0; round < 20; round++) {
      const target = email(`rc${round}`);
      const { inviteId } = await createInvite(
        deps,
        a.owner,
        { kind: "new", name: `C${round}`, email: target, role: "WORKER" },
        NOW
      );
      const [resendCode, createCode] = await Promise.all([
        codeOf(resendInvite(deps, a.owner, { inviteId, sendMail: false }, later)),
        codeOf(
          createInvite(
            deps,
            a.owner,
            { kind: "new", name: `D${round}`, email: target, role: "WORKER" },
            later
          )
        ),
      ]);
      // Resend first: the row is live again -> create is invite_pending. Create first: the expired row is revoked
      // -> resend is invite_gone.
      expect([
        ["ok", "invite_pending"],
        ["invite_gone", "ok"],
      ]).toContainEqual([resendCode, createCode]);
      expect(
        await prisma.flowkoBusinessInvite.count({
          where: {
            businessId: a.businessId,
            email: target,
            usedAt: null,
            revokedAt: null,
          },
        })
      ).toBe(1);
    }
  });

  it("create vs addDeskWorker with one name under the business lock: never a member clash the create missed (20 rounds)", async () => {
    const { deps } = mailer();
    const b = await freshBusiness("Clash");
    for (let round = 0; round < 20; round++) {
      const [createCode, addCode] = await Promise.all([
        codeOf(
          createInvite(
            deps,
            b.owner,
            {
              kind: "new",
              name: `Maja${round}`,
              email: email(`cl${round}`),
              role: "WORKER",
            },
            NOW
          )
        ),
        codeOf(addDeskWorker(prisma, b.owner, { displayName: ` maja${round} ` })),
      ]);
      // addDeskWorker first -> the create sees the member (member_name_taken); create first -> both succeed (a
      // pending invite does not reserve its name, Open 7; the accept re-checks).
      expect(addCode).toBe("ok");
      expect(["ok", "member_name_taken"]).toContain(createCode);
    }
  });

  it("C6 on Postgres: a locked user with a mixed-case e-mail and a secondary e-mail are email_has_login", async () => {
    const { deps, sendInvite } = mailer();
    const lockedId = await realUser("Zaklenjen", `Zaklenjen-${RUN}@Example.com`);
    await prisma.user.update({
      where: { id: lockedId },
      data: { locked: true },
    });
    await prisma.secondaryEmail.create({
      data: { userId: lockedId, email: `Druga-${RUN}@Example.com` },
    });
    for (const address of [
      `zaklenjen-${RUN}@example.com`,
      `ZAKLENJEN-${RUN}@EXAMPLE.COM`,
      `druga-${RUN}@example.com`,
    ]) {
      expect(
        await codeOf(
          createInvite(deps, a.owner, { kind: "new", name: "Z", email: address, role: "WORKER" }, NOW)
        )
      ).toBe("email_has_login");
    }
    expect(sendInvite).not.toHaveBeenCalled();
    expect(
      await prisma.flowkoBusinessInvite.count({
        where: {
          email: {
            in: [`zaklenjen-${RUN}@example.com`, `druga-${RUN}@example.com`],
          },
        },
      })
    ).toBe(0);
  });

  it("SPEC-2 on Postgres: `_` in an address is no ILIKE wildcard at create and resend; another case of it is a login", async () => {
    const { deps, sendInvite } = mailer();
    await realUser("Anaxb", email("anaxb"));
    // ana_b- / ____b- would match anaxb- as ILIKE patterns: neither has a login.
    for (const address of [email("ana_b"), email("____b")]) {
      expect(
        await codeOf(
          createInvite(
            deps,
            a.owner,
            { kind: "new", name: address.slice(0, 5), email: address, role: "WORKER" },
            NOW
          )
        )
      ).toBe("ok");
    }
    expect(sendInvite).toHaveBeenCalledTimes(2);
    // The exact address in upper case (a user) and in mixed case (a secondary e-mail) is a login.
    await realUser("Anac", email("ANA_C"));
    const owner2 = await realUser("Anad");
    await prisma.secondaryEmail.create({ data: { userId: owner2, email: email("Ana_D") } });
    for (const address of [email("ana_c"), email("ana_d")]) {
      expect(
        await codeOf(
          createInvite(deps, a.owner, { kind: "new", name: "Cd", email: address, role: "WORKER" }, NOW)
        )
      ).toBe("email_has_login");
    }
    // Resend: a login that only matches as a pattern appears after the create; the resend still goes out.
    const { inviteId } = await createInvite(
      deps,
      a.owner,
      { kind: "new", name: "Anae", email: email("ana_e"), role: "WORKER" },
      NOW
    );
    await realUser("Anaxe", email("anaxe"));
    expect(await codeOf(resendInvite(deps, a.owner, { inviteId, sendMail: false }, NOW))).toBe("ok");
    await realUser("Anae", email("ANA_E"));
    expect(await codeOf(resendInvite(deps, a.owner, { inviteId, sendMail: false }, NOW))).toBe(
      "email_has_login"
    );
  });

  it("rights on Postgres: another business's owner is forbidden on all three, nothing written", async () => {
    const { deps, sendInvite } = mailer();
    const b = await freshBusiness("Rights");
    const desk = await createDeskOnlyWorker(prisma, a.businessId, `Rights ${RUN}`);
    const { inviteId } = await createInvite(
      deps,
      a.owner,
      { kind: "new", name: "Rights", email: email("rights"), role: "WORKER" },
      NOW
    );
    const before = await prisma.flowkoBusinessInvite.findUniqueOrThrow({
      where: { id: inviteId },
    });
    sendInvite.mockClear();
    expect(
      await codeOf(
        createInvite(deps, b.owner, { kind: "member", memberId: desk.memberId, email: email("r2") }, NOW)
      )
    ).toBe("forbidden");
    expect(await codeOf(resendInvite(deps, b.owner, { inviteId, sendMail: true }, NOW))).toBe("forbidden");
    expect(await codeOf(revokeInvite(prisma, b.owner, { inviteId }, NOW))).toBe("forbidden");
    expect(
      await prisma.flowkoBusinessInvite.findUniqueOrThrow({
        where: { id: inviteId },
      })
    ).toEqual(before);
    expect(
      await prisma.flowkoBusinessInvite.count({
        where: { memberId: desk.memberId },
      })
    ).toBe(0);
    expect(sendInvite).not.toHaveBeenCalled();
  });
});
