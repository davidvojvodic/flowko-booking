// @vitest-environment node
// Flowko U29d: the brand-new accept (A1 loader, A3, A4) on a real database (602 migrations): the user and member
// rows it writes (usual week copied, or SQL NULL), the created login found by Cal's credentials lookup with an
// upper-case typed e-mail and its bcrypt hash verified; Review Focus 2 (20 rounds of two parallel accepts of one
// token -> exactly one success; two businesses' invites of one e-mail accepted in parallel -> one email_has_login;
// the real adapter meta of the users e-mail violation and its mapping outside the transaction); Review Focus 6
// (accept vs addDeskWorker vs createInvite in one business, 20 rounds -> no deadlock, positions distinct); C6 with
// a locked mixed-case user. Runs only with VITEST_MODE=integration against the throwaway DB.
import { hashPassword } from "@calcom/lib/auth/hashPassword";
import prisma from "@calcom/prisma";
import type { MailSendOutcome } from "@calcom/emails/templates/_base-email";
import { Prisma } from "@calcom/prisma/client";
import { IdentityProvider } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../auth/lib/verifyPassword";
import { UserRepository } from "../users/repositories/UserRepository";
import { createBusiness } from "./business";
import { FlowkoBusinessError } from "./errors";
import { acceptInvite, readInviteForAcceptPage } from "./inviteAccept";
import { createInvite, type InviteDeps, type InviteMailArgs, inviteUniqueConflictCode } from "./invites";
import { addDeskWorker } from "./workers";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const BASE = "https://booking.example";
const PASSWORD = "Geslo123";
const ROUNDS = 20;
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

/** A cheap stand-in for bcrypt in the race rounds (the real hash is proven in the sign-in test). */
const fastHash = async (pw: string) => `stub:${pw.length}`;

function deps(): InviteDeps {
  return {
    db: prisma,
    baseUrl: BASE,
    sendInvite: vi.fn(async (_args: InviteMailArgs): Promise<MailSendOutcome> => "sent"),
  };
}
const tokenOf = (link: string) => link.slice(`${BASE}/auth/pridruzi/`.length);
const email = (label: string) => `${label}-${RUN}@example.com`.toLowerCase();

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    if (err instanceof FlowkoBusinessError) return err.code;
    throw err;
  }
}

async function freshBusiness(
  label: string,
  usualWeek: unknown = null
): Promise<{ owner: number; businessId: number }> {
  const username = `own${label.toLowerCase()}-${RUN}`;
  const owner = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name: `Own${label}`, completedOnboarding: true },
    select: { id: true },
  });
  const created = await createBusiness(prisma, {
    ownerUserId: owner.id,
    name: `Salon ${label} ${RUN}`,
    slug: `salon-${label.toLowerCase()}-${RUN}`,
    templateId: "hair-salon",
  });
  if (usualWeek !== null) {
    await prisma.flowkoBusinessMember.update({
      where: { id: created.ownerMemberId },
      data: { usualWeek: usualWeek as Prisma.InputJsonValue },
    });
  }
  return { owner: owner.id, businessId: created.businessId };
}

async function newInvite(
  business: { owner: number },
  label: string,
  role: "WORKER" | "STAFF" = "WORKER",
  mail = email(label)
): Promise<string> {
  const answer = await createInvite(
    deps(),
    business.owner,
    { kind: "new", name: label, email: mail, role },
    NOW
  );
  return tokenOf(answer.link);
}

async function usualWeekIsNull(memberId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ none: boolean }>>`
    SELECT "usualWeek" IS NULL AS none FROM "FlowkoBusinessMember" WHERE "id" = ${memberId}`;
  return rows[0].none;
}

let a: { owner: number; businessId: number };
beforeAll(async () => {
  a = await freshBusiness("Acc", OWNER_WEEK);
});

describe("U29d brand-new accept on a real database", () => {
  it("writes a login user and a WORKER member with the owner's week; Cal's sign-in lookup finds it in any case", async () => {
    const token = await newInvite(a, "Hana");
    expect(await readInviteForAcceptPage(prisma, token, NOW)).toEqual({
      state: "open",
      businessName: `Salon Acc ${RUN}`,
      email: email("Hana"),
      name: "Hana",
      kind: "new",
    });
    const answer = await acceptInvite(
      { db: prisma, hashPassword },
      { token, name: "  Hana Novak  ", password: PASSWORD },
      NOW
    );
    expect(answer).toEqual({ status: "accepted", email: email("Hana") });
    expect(await readInviteForAcceptPage(prisma, token, NOW)).toEqual({ state: "invalid" });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: email("Hana") } });
    expect(user).toMatchObject({
      name: "Hana Novak",
      username: null,
      emailVerified: NOW,
      completedOnboarding: true,
      identityProvider: IdentityProvider.CAL,
      identityProviderId: null,
      locale: "sl",
      timeZone: "Europe/Ljubljana",
      timeFormat: 24,
      weekStart: "Monday",
      locked: false,
    });
    const member = await prisma.flowkoBusinessMember.findUniqueOrThrow({ where: { userId: user.id } });
    expect(member).toMatchObject({
      businessId: a.businessId,
      role: "WORKER",
      status: "ACTIVE",
      displayName: "Hana Novak",
    });
    expect(member.usualWeek).toEqual(OWNER_WEEK);
    expect(await prisma.flowkoServiceWorker.count({ where: { memberId: member.id } })).toBe(0);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.schedule.count({ where: { userId: user.id } })).toBe(0);

    // The credentials provider looks the user up by `email.toLowerCase()` (next-auth-options.ts).
    const repo = new UserRepository(prisma);
    const found = await repo.findByEmailAndIncludeProfilesAndPassword({ email: email("Hana").toUpperCase() });
    expect(found?.id).toBe(user.id);
    expect(found?.locked).toBe(false);
    expect(found?.password?.hash).toBeTruthy();
    expect(await verifyPassword(PASSWORD, found?.password?.hash ?? "")).toBe(true);
  });

  it("STAFF and a WORKER of an owner without a usual week get SQL NULL", async () => {
    const staffToken = await newInvite(a, "Rea", "STAFF");
    await acceptInvite(
      { db: prisma, hashPassword: fastHash },
      { token: staffToken, name: "Rea", password: PASSWORD },
      NOW
    );
    const rea = await prisma.flowkoBusinessMember.findFirstOrThrow({
      where: { businessId: a.businessId, displayName: "Rea" },
    });
    expect(rea.role).toBe("STAFF");
    expect(await usualWeekIsNull(rea.id)).toBe(true);

    const bare = await freshBusiness("Bare");
    const token = await newInvite(bare, "Iva");
    await acceptInvite(
      { db: prisma, hashPassword: fastHash },
      { token, name: "Iva", password: PASSWORD },
      NOW
    );
    const iva = await prisma.flowkoBusinessMember.findFirstOrThrow({
      where: { businessId: bare.businessId, displayName: "Iva" },
    });
    expect(iva.role).toBe("WORKER");
    expect(await usualWeekIsNull(iva.id)).toBe(true);
  });

  it("C6 on Postgres: a locked user with a mixed-case e-mail created after the invite -> email_has_login", async () => {
    const token = await newInvite(a, "Kasna");
    await prisma.user.create({
      data: { email: email("Kasna").toUpperCase(), username: `kasna-${RUN}`, name: "K", locked: true },
    });
    expect(
      await codeOf(
        acceptInvite(
          { db: prisma, hashPassword: fastHash },
          { token, name: "Kasna", password: PASSWORD },
          NOW
        )
      )
    ).toBe("email_has_login");
    expect(await readInviteForAcceptPage(prisma, token, NOW)).toMatchObject({ state: "open" });
  });

  it(`Review Focus 2: ${ROUNDS} rounds of two parallel accepts of one token -> exactly one success`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const token = await newInvite(a, `Dvojna${round}`);
      const results = await Promise.all([
        codeOf(
          acceptInvite(
            { db: prisma, hashPassword: fastHash },
            { token, name: `Dvojna${round}`, password: PASSWORD },
            NOW
          )
        ),
        codeOf(
          acceptInvite(
            { db: prisma, hashPassword: fastHash },
            { token, name: `Dvojna${round} B`, password: PASSWORD },
            NOW
          )
        ),
      ]);
      expect(results.slice().sort()).toEqual(["invite_invalid", "ok"]);
      expect(await prisma.user.count({ where: { email: email(`Dvojna${round}`) } })).toBe(1);
      expect(
        await prisma.flowkoBusinessMember.count({
          where: { businessId: a.businessId, displayName: { startsWith: `Dvojna${round}` } },
        })
      ).toBe(1);
    }
  });

  it("the real adapter meta of a users e-mail violation maps to email_has_login", async () => {
    const mail = email("Meta");
    await prisma.user.create({ data: { email: mail, username: `meta-${RUN}`, name: "M" } });
    let caught: unknown;
    try {
      await prisma.user.create({ data: { email: mail, username: `meta2-${RUN}`, name: "M2" } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const known = caught as Prisma.PrismaClientKnownRequestError;
    expect(known.code).toBe("P2002");
    expect(known.meta).toMatchObject({
      modelName: "User",
      driverAdapterError: { cause: { constraint: { fields: ["email"] } } },
    });
    expect(inviteUniqueConflictCode(known)).toBe("email_has_login");
  });

  it("a users e-mail violation inside the accept transaction is email_has_login, mapped outside it", async () => {
    // C6 is blinded inside the transaction (it would see the committed user), so the insert itself hits
    // users_email_key, which aborts the Postgres transaction; the mapping must run after the rollback.
    const business = await freshBusiness("Blind");
    const token = await newInvite(business, "Slepa");
    await prisma.user.create({ data: { email: email("Slepa"), username: `slepa-${RUN}`, name: "S" } });
    const blinded = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
        return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(txTarget, txProp, txReceiver) {
                  const model = Reflect.get(txTarget, txProp, txReceiver);
                  if (txProp !== "user" && txProp !== "secondaryEmail") return model;
                  return new Proxy(model as object, {
                    get(m, op, r) {
                      if (op === "findFirst") return async () => null;
                      return Reflect.get(m, op, r);
                    },
                  });
                },
              })
            )
          );
      },
    });
    expect(
      await codeOf(
        acceptInvite(
          { db: blinded as typeof prisma, hashPassword: fastHash },
          { token, name: "Slepa", password: PASSWORD },
          NOW
        )
      )
    ).toBe("email_has_login");
    expect(
      await prisma.flowkoBusinessMember.count({
        where: { businessId: business.businessId, displayName: "Slepa" },
      })
    ).toBe(0);
    expect(await readInviteForAcceptPage(prisma, token, NOW)).toMatchObject({ state: "open" });
  });

  it(`Review Focus 2: ${ROUNDS} rounds of two businesses' invites of one e-mail accepted in parallel -> one email_has_login`, async () => {
    const b = await freshBusiness("Druga");
    for (let round = 0; round < ROUNDS; round++) {
      const mail = email(`Oba${round}`);
      const tokenA = await newInvite(a, `ObaA${round}`, "WORKER", mail);
      const tokenB = await newInvite(b, `ObaB${round}`, "WORKER", mail);
      const results = await Promise.all([
        codeOf(
          acceptInvite(
            { db: prisma, hashPassword: fastHash },
            { token: tokenA, name: `ObaA${round}`, password: PASSWORD },
            NOW
          )
        ),
        codeOf(
          acceptInvite(
            { db: prisma, hashPassword: fastHash },
            { token: tokenB, name: `ObaB${round}`, password: PASSWORD },
            NOW
          )
        ),
      ]);
      expect(results.slice().sort()).toEqual(["email_has_login", "ok"]);
      expect(await prisma.user.count({ where: { email: mail } })).toBe(1);
    }
  });

  it(`Review Focus 6: ${ROUNDS} rounds of accept vs addDeskWorker vs createInvite -> no deadlock, distinct positions`, async () => {
    const c = await freshBusiness("Tri", OWNER_WEEK);
    for (let round = 0; round < ROUNDS; round++) {
      const token = await newInvite(c, `Sprejet${round}`);
      const results = await Promise.all([
        codeOf(
          acceptInvite(
            { db: prisma, hashPassword: fastHash },
            { token, name: `Sprejet${round}`, password: PASSWORD },
            NOW
          )
        ),
        codeOf(addDeskWorker(prisma, c.owner, { displayName: `Desk${round}` })),
        codeOf(
          createInvite(
            deps(),
            c.owner,
            { kind: "new", name: `Nov${round}`, email: email(`Nov${round}`), role: "STAFF" },
            NOW
          )
        ),
      ]);
      expect(results).toEqual(["ok", "ok", "ok"]);
    }
    const members = await prisma.flowkoBusinessMember.findMany({
      where: { businessId: c.businessId },
      select: { position: true },
    });
    expect(members).toHaveLength(1 + 2 * ROUNDS);
    expect(new Set(members.map((m) => m.position)).size).toBe(members.length);
  });
});
