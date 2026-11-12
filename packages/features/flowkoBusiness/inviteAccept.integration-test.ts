// @vitest-environment node
// Flowko U29d: the brand-new accept (A1 loader, A3, A4) on a real database (602 migrations): the user and member
// rows it writes (usual week copied, or SQL NULL), the created login found by Cal's credentials lookup with an
// upper-case typed e-mail and its bcrypt hash verified; Review Focus 2 (20 rounds of two parallel accepts of one
// token -> exactly one success; two businesses' invites of one e-mail accepted in parallel -> one email_has_login;
// the real adapter meta of the users e-mail violation and its mapping outside the transaction); Review Focus 6
// (accept vs addDeskWorker vs createInvite in one business, 20 rounds -> no deadlock, positions distinct); C6 with
// a locked mixed-case user. Runs only with VITEST_MODE=integration against the throwaway DB.
// Flowko U29d (Task 4, D2, C9): the desk-only conversion on Postgres: Review Focus 3 (the same member and user row,
// the member row byte-equal with its updatedAt, roster day, absence, service, mirror and booking kept, only the
// user's identity fields changed, the BookingDenormalized trigger follows, the old booking keeps the desk
// userPrimaryEmail); Review Focus 6 (20 rounds conversion vs lockMember and 20 rounds conversion vs a booking of
// that worker: no deadlock, status and User.locked agree); a users e-mail violation inside the conversion mapped
// after the rollback; a deleted member's invite is gone with it (cascade).
import { hashPassword } from "@calcom/lib/auth/hashPassword";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import type { MailSendOutcome } from "@calcom/emails/templates/_base-email";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoMemberStatus, IdentityProvider } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../auth/lib/verifyPassword";
import { UserRepository } from "../users/repositories/UserRepository";
import { getBusinessAccess, listMembers } from "./access";
import { createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { createBusiness, createDeskOnlyWorker } from "./business";
import type { GoogleDisconnect } from "./disconnectGoogle";
import { FlowkoBusinessError } from "./errors";
import { acceptInvite, readInviteForAcceptPage } from "./inviteAccept";
import { createInvite, type InviteDeps, type InviteMailArgs, inviteUniqueConflictCode } from "./invites";
import { lockMember } from "./lock";
import { setUsualWeek } from "./roster";
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

describe("U29d desk-only conversion on a real database (D2, C9)", () => {
  const TZ = "Europe/Ljubljana";
  const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
  const quiet: WriterDeps = { googleBusy: async () => ({ busy: [], unavailable: false }), sendMails: false };
  const noGoogle = vi.fn(async (): Promise<GoogleDisconnect> => "none");
  // 24 distinct hourly slots (Tue to Thu, 08:00 to 15:00), in the week after NOW.
  const SLOTS = ["2026-11-17", "2026-11-18", "2026-11-19"].flatMap((date) =>
    ["08", "09", "10", "11", "12", "13", "14", "15"].map((h) => at(date, `${h}:00`))
  );
  const hours: ShiftEntry[] = [{ from: "08:00", to: "16:00" }];
  const WEEK: WeekHours = { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: [], sun: [] };

  let conv: { owner: number; businessId: number };
  let mens: number;

  beforeAll(async () => {
    conv = await freshBusiness("Pret");
    await prisma.flowkoBusiness.update({ where: { id: conv.businessId }, data: { openHolidays: [] } });
    const service = await prisma.flowkoService.findFirstOrThrow({
      where: { businessId: conv.businessId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    mens = service.id;
  });

  /** A desk-only WORKER with a service and a usual week, and its open invite; answers the ids and the raw token. */
  async function deskWithInvite(label: string): Promise<{ memberId: number; userId: number; token: string }> {
    const desk = await createDeskOnlyWorker(prisma, conv.businessId, label);
    await prisma.flowkoServiceWorker.create({ data: { serviceId: mens, memberId: desk.memberId } });
    await setUsualWeek(prisma, conv.owner, {
      memberId: desk.memberId,
      usualWeek: WEEK,
      confirmOutsideOpening: false,
    });
    const answer = await createInvite(
      deps(),
      conv.owner,
      { kind: "member", memberId: desk.memberId, email: email(label) },
      NOW
    );
    return { ...desk, token: tokenOf(answer.link) };
  }

  function book(memberId: number, start: Date) {
    return createBusinessBooking(
      prisma,
      conv.owner,
      {
        workerMemberId: memberId,
        serviceIds: [mens],
        start,
        customer: { name: "Ana Testna", phone: "041 123 456", email: null },
        confirmOverride: false,
      },
      NOW,
      quiet
    );
  }

  /** The user row read past Cal's excludeLockedUsers. */
  const userOf = (id: number) =>
    prisma.user.findFirstOrThrow({ where: { id, OR: [{ locked: false }, { locked: true }] } });

  async function denormEmail(bookingId: number): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ userEmail: string | null }>>`
      SELECT "userEmail" FROM "BookingDenormalized" WHERE "id" = ${bookingId}`;
    return rows[0]?.userEmail ?? null;
  }

  /** FLOWKO.md's U25 post-deploy check: members whose lock flag differs from their user's (desk aside). */
  async function lockDisagreements(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM "FlowkoBusinessMember" m JOIN users u ON u.id = m."userId"
      WHERE (m.status = 'LOCKED') <> u.locked AND u.email NOT LIKE '%@flowko.invalid'`;
    return Number(rows[0].count);
  }

  it("Review Focus 3: the same member and user; member row (updatedAt too) and its column data unchanged; identity fields only", async () => {
    const desk = await deskWithInvite("Pretvorba");
    const booked = await book(desk.memberId, SLOTS[0]);
    if (booked.status !== "created") throw new Error(`booking not created: ${booked.status}`);
    await prisma.flowkoRosterDay.create({
      data: {
        memberId: desk.memberId,
        date: new Date("2026-11-25T00:00:00Z"),
        shifts: [{ from: "09:00", to: "17:00" }],
      },
    });
    await prisma.flowkoAbsence.create({
      data: {
        memberId: desk.memberId,
        startDate: new Date("2026-12-01T00:00:00Z"),
        endDate: new Date("2026-12-02T00:00:00Z"),
      },
    });
    const deskUser = await userOf(desk.userId);
    const snapshot = async () => ({
      member: await prisma.flowkoBusinessMember.findUniqueOrThrow({ where: { id: desk.memberId } }),
      rosterDays: await prisma.flowkoRosterDay.findMany({ where: { memberId: desk.memberId } }),
      absences: await prisma.flowkoAbsence.findMany({ where: { memberId: desk.memberId } }),
      services: await prisma.flowkoServiceWorker.findMany({ where: { memberId: desk.memberId } }),
      mirror: await prisma.flowkoWorkerMirror.findUnique({ where: { memberId: desk.memberId } }),
      bookings: await prisma.booking.findMany({
        where: { userId: desk.userId },
        select: { id: true, userId: true, eventTypeId: true, userPrimaryEmail: true, status: true },
      }),
    });
    const before = await snapshot();
    expect(before.mirror).not.toBeNull();
    expect(before.bookings).toHaveLength(1);
    expect(await denormEmail(booked.bookingId)).toBe(deskUser.email);
    const counts = async () => ({
      users: await prisma.user.count({ where: { OR: [{ locked: false }, { locked: true }] } }),
      members: await prisma.flowkoBusinessMember.count(),
      memberships: await prisma.membership.count({ where: { userId: desk.userId } }),
      profiles: await prisma.profile.count({ where: { userId: desk.userId } }),
    });
    const countsBefore = await counts();

    const answer = await acceptInvite(
      { db: prisma, hashPassword },
      { token: desk.token, name: "  Pretvorba B  ", password: PASSWORD },
      NOW
    );

    expect(answer).toEqual({ status: "accepted", email: email("Pretvorba") });
    // Every row on the member or user id is as it was; the member row was never written (updatedAt unchanged).
    expect(await snapshot()).toEqual(before);
    expect(before.member.displayName).toBe("Pretvorba");
    expect(before.bookings[0].userPrimaryEmail).toBe(deskUser.email); // D5
    expect(await counts()).toEqual(countsBefore);
    // The users UPDATE fires the BookingDenormalized trigger in the same transaction.
    expect(await denormEmail(booked.bookingId)).toBe(email("Pretvorba"));

    const user = await userOf(desk.userId);
    expect(user).toMatchObject({
      id: desk.userId,
      email: email("Pretvorba"),
      name: "Pretvorba B",
      username: null,
      emailVerified: NOW,
      identityProvider: IdentityProvider.CAL,
      identityProviderId: null,
      completedOnboarding: true,
      locked: false,
      // untouched: the desk-only defaults
      timeZone: deskUser.timeZone,
      locale: deskUser.locale,
      timeFormat: deskUser.timeFormat,
      weekStart: deskUser.weekStart,
      defaultScheduleId: deskUser.defaultScheduleId,
      createdDate: deskUser.createdDate,
    });
    expect(await prisma.userPassword.count({ where: { userId: desk.userId } })).toBe(1);

    // The credentials lookup finds the same user with any case, and the bcrypt hash verifies.
    const found = await new UserRepository(prisma).findByEmailAndIncludeProfilesAndPassword({
      email: email("Pretvorba").toUpperCase(),
    });
    expect(found?.id).toBe(desk.userId);
    expect(await verifyPassword(PASSWORD, found?.password?.hash ?? "")).toBe(true);

    expect(await getBusinessAccess(prisma, desk.userId)).toEqual({
      businessId: conv.businessId,
      memberId: desk.memberId,
      userId: desk.userId,
      role: "WORKER",
    });
    expect(
      (await listMembers(prisma, conv.businessId)).find((m) => m.memberId === desk.memberId)
    ).toMatchObject({
      deskOnly: false,
    });
    expect(await readInviteForAcceptPage(prisma, desk.token, NOW)).toEqual({ state: "invalid" });
    // A second invite of the now-login member is refused (not desk-only any more).
    expect(
      await codeOf(
        createInvite(
          deps(),
          conv.owner,
          { kind: "member", memberId: desk.memberId, email: email("Pretvorba-2") },
          NOW
        )
      )
    ).toBe("member_not_desk_only");
  });

  it(`Review Focus 6: ${ROUNDS} rounds of a conversion racing lockMember: no deadlock, status and User.locked agree`, async () => {
    const tally = { convertedThenLocked: 0, lockedFirst: 0 };
    for (let round = 0; round < ROUNDS; round += 1) {
      const desk = await deskWithInvite(`Zaklep${round}`);
      const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      const [accepted, locked] = await Promise.all([
        delay(round % 2 === 0 ? 0 : (round % 5) * 3).then(() =>
          codeOf(
            acceptInvite(
              { db: prisma, hashPassword: fastHash },
              { token: desk.token, name: `Zaklep${round}`, password: PASSWORD },
              NOW
            )
          )
        ),
        delay(round % 2 === 0 ? (round % 5) * 3 : 0).then(() =>
          codeOf(lockMember({ db: prisma, disconnectGoogle: noGoogle }, conv.owner, desk.memberId, NOW))
        ),
      ]);
      expect(locked).toBe("ok");
      expect(["ok", "invite_invalid"]).toContain(accepted);
      const member = await prisma.flowkoBusinessMember.findUniqueOrThrow({ where: { id: desk.memberId } });
      const user = await userOf(desk.userId);
      expect(member.status).toBe(FlowkoMemberStatus.LOCKED);
      if (accepted === "ok") {
        // Converted first: the lock re-read the real e-mail inside its transaction and locked the login.
        tally.convertedThenLocked += 1;
        expect(user.email).toBe(email(`Zaklep${round}`));
        expect(user.locked).toBe(true);
      } else {
        // Locked first: the conversion re-read LOCKED under the locks and wrote nothing.
        tally.lockedFirst += 1;
        expect(user.email.endsWith("@flowko.invalid")).toBe(true);
        expect(user.locked).toBe(false);
        expect(await prisma.userPassword.count({ where: { userId: desk.userId } })).toBe(0);
      }
      expect(await lockDisagreements()).toBe(0);
    }
    expect(tally.convertedThenLocked + tally.lockedFirst).toBe(ROUNDS);
  });

  it(`Review Focus 6: ${ROUNDS} rounds of a conversion racing a booking of that worker: no deadlock, the booking keeps the user id`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const desk = await deskWithInvite(`Termin${round}`);
      const [accepted, booked] = await Promise.all([
        codeOf(
          acceptInvite(
            { db: prisma, hashPassword: fastHash },
            { token: desk.token, name: `Termin${round}`, password: PASSWORD },
            NOW
          )
        ),
        codeOf(book(desk.memberId, SLOTS[round % SLOTS.length])),
      ]);
      expect([accepted, booked]).toEqual(["ok", "ok"]);
      const bookings = await prisma.booking.findMany({
        where: { userId: desk.userId },
        select: { id: true, eventTypeId: true },
      });
      expect(bookings).toHaveLength(1);
      const mirror = await prisma.flowkoWorkerMirror.findUniqueOrThrow({
        where: { memberId: desk.memberId },
      });
      expect(bookings[0].eventTypeId).toBe(mirror.eventTypeId);
      expect((await userOf(desk.userId)).email).toBe(email(`Termin${round}`));
      // Whichever committed first, the denormalized row ends with the real address (insert or update trigger).
      expect(await denormEmail(bookings[0].id)).toBe(email(`Termin${round}`));
    }
  });

  it("a users e-mail violation inside the conversion is email_has_login, mapped after the rollback; the user stays desk-only", async () => {
    const desk = await deskWithInvite("Slepa2");
    await prisma.user.create({ data: { email: email("Slepa2"), username: `slepa2-${RUN}`, name: "S" } });
    const deskBefore = await userOf(desk.userId);
    // C6 is blinded inside the transaction, so the users UPDATE itself hits users_email_key.
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
          { token: desk.token, name: "Slepa2", password: PASSWORD },
          NOW
        )
      )
    ).toBe("email_has_login");
    expect(await userOf(desk.userId)).toEqual(deskBefore);
    expect(await prisma.userPassword.count({ where: { userId: desk.userId } })).toBe(0);
    expect(await readInviteForAcceptPage(prisma, desk.token, NOW)).toMatchObject({
      state: "open",
      kind: "member",
    });
  });

  it("a deleted member takes its invite with it (cascade): the link is invalid", async () => {
    const desk = await deskWithInvite("Odsel");
    await prisma.flowkoBusinessMember.delete({ where: { id: desk.memberId } });
    expect(await readInviteForAcceptPage(prisma, desk.token, NOW)).toEqual({ state: "invalid" });
    expect(
      await codeOf(
        acceptInvite(
          { db: prisma, hashPassword: fastHash },
          { token: desk.token, name: "Odsel", password: PASSWORD },
          NOW
        )
      )
    ).toBe("invite_invalid");
  });
});
