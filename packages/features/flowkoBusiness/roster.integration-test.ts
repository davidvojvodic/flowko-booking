// @vitest-environment node
// Flowko U26: the roster services on a real database (prismock ignores unique keys, CHECKs and Prisma's
// DbNull/JsonNull distinction). Proves: a week write touches only its seven dates and a second write of the same
// week leaves one row per (member, date) (the unique key); two concurrent writers of one week end in one row per
// date and each call either succeeds or answers roster_conflict (never a raw P2002); clearing a usual week
// stores SQL NULL (no 23514 from the usualWeek CHECK); an absence longer than 365 days or ending before it starts
// is refused by the service (bad_absence) before the CHECK can fire. Runs only with VITEST_MODE=integration
// against the throwaway DB.

import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
import { addLoginMember, createBusiness } from "./business";
import { FlowkoBusinessError } from "./errors";
import { addAbsence, getRosterWeek, setRosterWeek, setUsualWeek } from "./roster";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date("2026-11-07T12:00:00Z");
const EARLY = [{ from: "07:00", to: "15:00" }];
const NULL_WEEK = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

async function plainUser(name: string): Promise<number> {
  const username = `${name}-${RUN}`;
  const user = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  return user.id;
}

async function datesOf(memberId: number): Promise<string[]> {
  const rows = await prisma.flowkoRosterDay.findMany({
    where: { memberId },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => r.date.toISOString().slice(0, 10));
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

describe("U26 roster services on a real database", () => {
  let ownerUserId: number;
  let workerUserId: number;
  let ownerMemberId: number;
  let workerMemberId: number;

  beforeAll(async () => {
    ownerUserId = await plainUser("roster-svc-owner");
    workerUserId = await plainUser("roster-svc-ana");
    const created = await createBusiness(prisma, {
      ownerUserId,
      name: `Salon ${RUN}`,
      slug: `roster-svc-${RUN}`,
      templateId: "hair-salon",
    });
    ownerMemberId = created.ownerMemberId;
    const worker = await addLoginMember(prisma, created.businessId, workerUserId, FlowkoBusinessRole.WORKER);
    workerMemberId = worker.memberId;
  });

  it("a week write touches only its seven dates; the same week twice keeps one row per date", async () => {
    await prisma.flowkoRosterDay.createMany({
      data: [
        { memberId: workerMemberId, date: new Date("2026-11-08T00:00:00Z"), shifts: EARLY },
        { memberId: workerMemberId, date: new Date("2026-11-12T00:00:00Z"), shifts: EARLY },
        { memberId: workerMemberId, date: new Date("2026-11-16T00:00:00Z"), shifts: EARLY },
      ],
    });
    const input = {
      memberId: workerMemberId,
      weekStart: "2026-11-09",
      days: { ...NULL_WEEK, mon: EARLY, tue: [] },
      confirmOutsideOpening: false,
    };
    await setRosterWeek(prisma, workerUserId, input, NOW);
    expect(await datesOf(workerMemberId)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-16"]);
    await setRosterWeek(prisma, workerUserId, input, NOW);
    expect(await datesOf(workerMemberId)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-16"]);
    const tue = await prisma.flowkoRosterDay.findFirstOrThrow({
      where: { memberId: workerMemberId, date: new Date("2026-11-10T00:00:00Z") },
      select: { shifts: true, updatedByUserId: true },
    });
    expect(tue).toEqual({ shifts: [], updatedByUserId: workerUserId });

    await setRosterWeek(prisma, workerUserId, { ...input, days: { ...NULL_WEEK, tue: [] } }, NOW);
    expect(await datesOf(workerMemberId)).toEqual(["2026-11-08", "2026-11-10", "2026-11-16"]);

    const view = await getRosterWeek(prisma, ownerUserId, "2026-11-09");
    const ana = view.members.find((m) => m.memberId === workerMemberId);
    expect(ana?.days.slice(0, 2).map((d) => [d.source, d.entries])).toEqual([
      ["none", []],
      ["planned", []],
    ]);
  });

  it("two concurrent writers of one week: one row per date, each call ok or roster_conflict", async () => {
    const write = (mon: typeof EARLY) =>
      setRosterWeek(
        prisma,
        ownerUserId,
        {
          memberId: ownerMemberId,
          weekStart: "2026-11-23",
          days: { ...NULL_WEEK, mon, wed: EARLY, fri: EARLY },
          confirmOutsideOpening: false,
        },
        NOW
      );
    const results = await Promise.all([
      codeOf(write(EARLY)),
      codeOf(write([{ from: "08:00", to: "16:00" }])),
      codeOf(write([{ from: "09:00", to: "17:00" }])),
    ]);
    for (const r of results) expect(["ok", "roster_conflict"]).toContain(r);
    expect(results).toContain("ok");
    expect(await datesOf(ownerMemberId)).toEqual(["2026-11-23", "2026-11-25", "2026-11-27"]);
  });

  it("clearing the usual week stores SQL NULL (no CHECK violation)", async () => {
    const usual = { mon: EARLY, tue: EARLY, wed: EARLY, thu: EARLY, fri: EARLY, sat: [], sun: [] };
    await setUsualWeek(prisma, ownerUserId, {
      memberId: workerMemberId,
      usualWeek: usual,
      confirmOutsideOpening: false,
    });
    const set = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "FlowkoBusinessMember"
      WHERE id = ${workerMemberId} AND "usualWeek" IS NOT NULL AND jsonb_typeof("usualWeek") = 'object'`;
    expect(Number(set[0].n)).toBe(1);

    await setUsualWeek(prisma, ownerUserId, {
      memberId: workerMemberId,
      usualWeek: null,
      confirmOutsideOpening: false,
    });
    const cleared = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM "FlowkoBusinessMember" WHERE id = ${workerMemberId} AND "usualWeek" IS NULL`;
    expect(Number(cleared[0].n)).toBe(1);
    const view = await getRosterWeek(prisma, ownerUserId, "2026-11-30");
    const ana = view.members.find((m) => m.memberId === workerMemberId);
    expect(ana?.usualWeek).toBeNull();
    expect(ana?.days.map((d) => d.source)).toEqual(Array(7).fill("none"));
  });

  it("an absence the CHECK would refuse is refused by the service first (bad_absence, no row)", async () => {
    const add = (startDate: string, endDate: string) =>
      codeOf(addAbsence(prisma, workerUserId, { memberId: workerMemberId, startDate, endDate }, NOW));
    expect(await add("2026-11-10", "2027-11-11")).toBe("bad_absence");
    expect(await add("2026-11-12", "2026-11-11")).toBe("bad_absence");
    expect(await prisma.flowkoAbsence.count({ where: { memberId: workerMemberId } })).toBe(0);
    expect(await add("2026-11-10", "2027-11-10")).toBe("ok");
    expect(await prisma.flowkoAbsence.count({ where: { memberId: workerMemberId } })).toBe(1);
  });
});
