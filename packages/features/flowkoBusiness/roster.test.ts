// Flowko U26: the roster services on prismock. Business A (owner Olga, login workers Ana and Bor, desk-only
// Cene, staff Rok with a login, locked worker Dan) and B (owner Zala, worker Bea); NOW = 2026-11-07T12:00:00Z
// (a Saturday; business today 2026-11-07). Covers the H3 rights table (missing = foreign = forbidden), week scope
// (G3: rows outside the seven dates untouched, null = no row, one row per date), the write window (G7), the
// opening cap (G6, changed days only), the usual week and its clear (SQL NULL), copy (G5), absences (H2) and the
// holiday settings (H1). Prismock ignores unique keys and CHECKs: roster.integration-test.ts repeats the
// week-scope, upsert and clear tests on Postgres.
// Flowko U29b: saveRosterWeek (S3) with NOW = Mon 2026-11-16 08:07 Ljubljana: rights per row (Review Focus 1),
// input, window, stale versions, past days, the warnings (Review Focus 3) and the 40P01 mapping; its locks and
// races are proven in roster-save.integration-test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; roster.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours, WeekPlan } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { usualVersionOf, weekVersionOf } from "./rosterVersion";
import {
  addAbsence,
  copyRosterWeek,
  getRosterWeek,
  type RosterWeekView,
  readUsualWeek,
  removeAbsence,
  saveRosterWeek,
  setHolidayOpen,
  setHolidaysClosed,
  setRosterWeek,
  setUsualWeek,
} from "./roster";

const db = prismock as unknown as FlowkoDb;
const NOW = new Date("2026-11-07T12:00:00Z");
let seq = 0;

const S = (from: string, to: string): ShiftEntry => ({ from, to });
const EARLY = [S("07:00", "15:00")];

function week(days: Partial<WeekPlan> = {}): WeekPlan {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null, ...days };
}

const MON_FRI_EARLY: WeekHours = {
  mon: EARLY,
  tue: EARLY,
  wed: EARLY,
  thu: EARLY,
  fri: EARLY,
  sat: [],
  sun: [],
};

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
  users: Record<Who, number>;
  members: Record<Who, number>;
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `salon-a-${seq}`,
    templateId: "hair-salon",
  });
  const a = created.businessId;
  // Prismock does not apply @default([]) to scalar lists (test-only; Task 1 proves the real default).
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

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function rowsOf(memberId: number): Promise<Array<{ date: string; shifts: unknown }>> {
  const rows = await prismock.flowkoRosterDay.findMany({ where: { memberId } });
  return rows
    .map((r) => ({ date: iso(r.date), shifts: r.shifts }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

async function seedRow(memberId: number, date: string, shifts: ShiftEntry[]): Promise<void> {
  await prismock.flowkoRosterDay.create({ data: { memberId, date: day(date), shifts } });
}

function memberOf(view: RosterWeekView, memberId: number) {
  const m = view.members.find((x) => x.memberId === memberId);
  if (!m) throw new Error("fixture: member not in view");
  return m;
}

let f: Fixture;

beforeEach(async () => {
  f = await setUp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rights (H3): access → target from the DB → right", () => {
  type Op = "week" | "absence" | "usual";
  const run = (op: Op, actorUserId: number, memberId: number) => {
    if (op === "week") {
      return setRosterWeek(
        db,
        actorUserId,
        { memberId, weekStart: "2026-11-09", days: week({ mon: EARLY }), confirmOutsideOpening: false },
        NOW
      );
    }
    if (op === "absence") {
      return addAbsence(db, actorUserId, { memberId, startDate: "2026-11-20", endDate: "2026-11-21" }, NOW);
    }
    return setUsualWeek(db, actorUserId, {
      memberId,
      usualWeek: MON_FRI_EARLY,
      confirmOutsideOpening: false,
    });
  };

  const TABLE: Array<{ actor: Who; target: Who | "missing"; week: string; absence: string; usual: string }> =
    [
      { actor: "olga", target: "ana", week: "ok", absence: "ok", usual: "ok" },
      { actor: "olga", target: "bor", week: "ok", absence: "ok", usual: "ok" },
      { actor: "olga", target: "cene", week: "ok", absence: "ok", usual: "ok" },
      { actor: "olga", target: "olga", week: "ok", absence: "ok", usual: "ok" },
      { actor: "olga", target: "rok", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "olga", target: "bea", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "olga", target: "missing", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "ana", target: "ana", week: "ok", absence: "ok", usual: "forbidden" },
      { actor: "ana", target: "bor", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "ana", target: "cene", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "ana", target: "bea", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "ana", target: "missing", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "rok", target: "ana", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "rok", target: "bor", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "rok", target: "cene", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "rok", target: "rok", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "rok", target: "bea", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "rok", target: "missing", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "dan", target: "dan", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "dan", target: "ana", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "olga", target: "dan", week: "ok", absence: "ok", usual: "ok" },
      { actor: "zala", target: "ana", week: "forbidden", absence: "forbidden", usual: "forbidden" },
      { actor: "zala", target: "bea", week: "ok", absence: "ok", usual: "ok" },
    ];

  it.each(TABLE)("$actor on $target: week $week, absence $absence, usual $usual", async (row) => {
    const target = row.target === "missing" ? 999999 : f.members[row.target];
    const actor = f.users[row.actor];
    expect(await outcome(run("week", actor, target))).toBe(row.week);
    expect(await outcome(run("absence", actor, target))).toBe(row.absence);
    expect(await outcome(run("usual", actor, target))).toBe(row.usual);
  });

  it("a refused write stores nothing", async () => {
    await outcome(run("week", f.users.ana, f.members.bor));
    await outcome(run("absence", f.users.ana, f.members.bor));
    await outcome(run("usual", f.users.ana, f.members.ana));
    expect(await rowsOf(f.members.bor)).toEqual([]);
    expect(await prismock.flowkoAbsence.count({ where: { memberId: f.members.bor } })).toBe(0);
    const ana = await prismock.flowkoBusinessMember.findUnique({ where: { id: f.members.ana } });
    expect(readUsualWeek(ana?.usualWeek)).toBeNull();
  });

  it("forbidden comes before input validation (a foreign member with a bad week is still forbidden)", async () => {
    const bad = setRosterWeek(
      db,
      f.users.olga,
      { memberId: f.members.bea, weekStart: "2026-11-10", days: week(), confirmOutsideOpening: false },
      NOW
    );
    expect(await outcome(bad)).toBe("forbidden");
  });
});

describe("setRosterWeek: week scope (G3)", () => {
  it("touches only the seven dates; null deletes the row, [] stores a day off", async () => {
    await seedRow(f.members.ana, "2026-11-08", EARLY);
    await seedRow(f.members.ana, "2026-11-11", EARLY);
    await seedRow(f.members.ana, "2026-11-16", EARLY);
    await setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ mon: EARLY, tue: [] }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-11-08", shifts: EARLY },
      { date: "2026-11-09", shifts: EARLY },
      { date: "2026-11-10", shifts: [] },
      { date: "2026-11-16", shifts: EARLY },
    ]);
    const stored = await prismock.flowkoRosterDay.findFirst({
      where: { memberId: f.members.ana, date: day("2026-11-09") },
    });
    expect(stored?.updatedByUserId).toBe(f.users.ana);

    await setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ tue: [] }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    expect((await rowsOf(f.members.ana)).map((r) => r.date)).toEqual([
      "2026-11-08",
      "2026-11-10",
      "2026-11-16",
    ]);
  });

  it("the same week written twice leaves exactly one row per stored date", async () => {
    const input = {
      memberId: f.members.ana,
      weekStart: "2026-11-09",
      days: week({ mon: EARLY, tue: [], fri: EARLY }),
      confirmOutsideOpening: false,
    };
    await setRosterWeek(db, f.users.olga, input, NOW);
    await setRosterWeek(db, f.users.olga, input, NOW);
    expect(await prismock.flowkoRosterDay.count({ where: { memberId: f.members.ana } })).toBe(3);
  });

  it("a unique violation (two writers of one week) is roster_conflict, not a 500", async () => {
    vi.spyOn(prismock.flowkoRosterDay, "createMany").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6",
      })
    );
    const result = setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ mon: EARLY }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    expect(await outcome(result)).toBe("roster_conflict");
  });

  it("a write conflict or deadlock (P2034) is roster_conflict too", async () => {
    vi.spyOn(prismock.flowkoRosterDay, "createMany").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Write conflict or a deadlock", {
        code: "P2034",
        clientVersion: "6",
      })
    );
    const result = setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ mon: EARLY }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    expect(await outcome(result)).toBe("roster_conflict");
  });

  it("current week (NOW = Saturday 11-07): past days keep their rows, today and later follow the write", async () => {
    const LATE = [S("12:00", "20:00")];
    await seedRow(f.members.ana, "2026-11-03", LATE);
    await seedRow(f.members.ana, "2026-11-06", LATE);
    await seedRow(f.members.ana, "2026-11-08", LATE);
    await setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-02",
        // mon/tue/fri are past days: ignored. sat = today: written. sun = null: row deleted.
        days: week({ mon: EARLY, tue: [], fri: [], sat: EARLY, sun: null }),
        confirmOutsideOpening: true,
      },
      NOW
    );
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-11-03", shifts: LATE },
      { date: "2026-11-06", shifts: LATE },
      { date: "2026-11-07", shifts: EARLY },
    ]);
  });

  it("a past day of the current week does not trigger the opening cap", async () => {
    await setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-02",
        days: week({ mon: [S("06:00", "13:00")] }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    expect(await rowsOf(f.members.ana)).toEqual([]);
  });

  it("other errors pass through unchanged", async () => {
    const boom = new Error("db down");
    vi.spyOn(prismock.flowkoRosterDay, "createMany").mockRejectedValueOnce(boom);
    const result = setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ mon: EARLY }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    await expect(result).rejects.toBe(boom);
  });
});

describe("setRosterWeek: window (G7) and input (bad_roster)", () => {
  const write = (weekStart: string, days: WeekPlan = week({ mon: EARLY })) =>
    outcome(
      setRosterWeek(
        db,
        f.users.olga,
        { memberId: f.members.ana, weekStart, days, confirmOutsideOpening: false },
        NOW
      )
    );

  it.each([
    ["2026-11-02", "ok"], // Sunday 11-08 ≥ today 11-07
    ["2026-10-26", "week_out_of_range"], // Sunday 11-01 < today
    ["2027-11-08", "ok"], // Monday ≤ today + 371 = 2027-11-13
    ["2027-11-15", "week_out_of_range"],
    ["2026-11-10", "bad_roster"], // a Tuesday
    ["2026-02-30", "bad_roster"],
    ["09.11.2026", "bad_roster"],
    ["1999-12-27", "bad_roster"],
  ])("week %s → %s", async (weekStart, expected) => {
    expect(await write(weekStart)).toBe(expected);
  });

  it("a malformed plan is bad_roster (zod's message is never passed on)", async () => {
    const overlapping = week({ mon: [S("07:00", "12:00"), S("11:00", "15:00")] });
    expect(await write("2026-11-09", overlapping)).toBe("bad_roster");
    expect(await write("2026-11-09", { ...week(), extra: [] } as unknown as WeekPlan)).toBe("bad_roster");
    const missingKey = { mon: null, tue: null } as unknown as WeekPlan;
    expect(await write("2026-11-09", missingKey)).toBe("bad_roster");
    expect(await write("2026-11-09", week({ mon: [S("02:30", "05:00")] }))).toBe("bad_roster");
    expect(await rowsOf(f.members.ana)).toEqual([]);
  });
});

describe("setRosterWeek: opening cap (G6)", () => {
  const write = (days: WeekPlan, confirmOutsideOpening: boolean) =>
    outcome(
      setRosterWeek(
        db,
        f.users.olga,
        { memberId: f.members.ana, weekStart: "2026-11-09", days, confirmOutsideOpening },
        NOW
      )
    );

  it("a shift outside the weekday's opening hours needs the confirmation", async () => {
    const early = week({ mon: [S("06:00", "13:00")] });
    expect(await write(early, false)).toBe("outside_opening");
    expect(await rowsOf(f.members.ana)).toEqual([]);
    expect(await write(early, true)).toBe("ok");
    expect(await rowsOf(f.members.ana)).toEqual([{ date: "2026-11-09", shifts: [S("06:00", "13:00")] }]);
  });

  it("a Sunday shift (template sun: []) is outside the opening hours", async () => {
    expect(await write(week({ sun: [S("09:00", "12:00")] }), false)).toBe("outside_opening");
  });

  it("an unchanged confirmed day needs no new confirmation; a changed one does", async () => {
    const early = [S("06:00", "13:00")];
    expect(await write(week({ mon: early }), true)).toBe("ok");
    expect(await write(week({ mon: early, tue: EARLY }), false)).toBe("ok");
    expect(await write(week({ mon: [S("06:00", "14:00")], tue: EARLY }), false)).toBe("outside_opening");
  });

  it("a holiday does not trigger the cap (Friday 2026-12-25 inside Friday hours)", async () => {
    const result = await outcome(
      setRosterWeek(
        db,
        f.users.olga,
        {
          memberId: f.members.ana,
          weekStart: "2026-12-21",
          days: week({ fri: EARLY }),
          confirmOutsideOpening: false,
        },
        NOW
      )
    );
    expect(result).toBe("ok");
  });
});

describe("setUsualWeek and getRosterWeek", () => {
  it("the owner sets a usual week: Ana usual Mon–Fri, Cene none, Rok not listed, Dan listed LOCKED", async () => {
    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: MON_FRI_EARLY,
      confirmOutsideOpening: false,
    });
    const view = await getRosterWeek(db, f.users.olga, "2026-11-16", NOW);
    expect(view).toMatchObject({ businessId: f.a, timeZone: "Europe/Ljubljana", weekStart: "2026-11-16" });
    expect(view.days.map((d) => d.date)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(view.days[0]).toEqual({ date: "2026-11-16", opening: [S("07:00", "20:00")], holiday: null });
    expect(view.days[6].opening).toEqual([]);

    expect(view.members.map((m) => m.memberId)).toEqual([
      f.members.olga,
      f.members.ana,
      f.members.bor,
      f.members.cene,
      f.members.dan,
    ]);
    const ana = memberOf(view, f.members.ana);
    expect(ana.usualWeek).toEqual(MON_FRI_EARLY);
    expect(ana.days.slice(0, 5).map((d) => [d.source, d.entries])).toEqual(Array(5).fill(["usual", EARLY]));
    expect(ana.days.slice(5).map((d) => [d.source, d.entries])).toEqual([
      ["usual", []],
      ["usual", []],
    ]);
    const cene = memberOf(view, f.members.cene);
    expect(cene.deskOnly).toBe(true);
    expect(cene.usualWeek).toBeNull();
    expect(cene.days.map((d) => d.source)).toEqual(Array(7).fill("none"));
    expect(memberOf(view, f.members.dan).status).toBe(FlowkoMemberStatus.LOCKED);
    expect(memberOf(view, f.members.ana).deskOnly).toBe(false);
    expect(view.members.some((m) => m.memberId === f.members.rok)).toBe(false);
    expect(view.canEditUsualWeek).toBe(true);
    expect(view.editableMemberIds).toEqual([
      f.members.olga,
      f.members.ana,
      f.members.bor,
      f.members.cene,
      f.members.dan,
    ]);
  });

  it("a planned day wins over the usual week; [] is a planned day off", async () => {
    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: MON_FRI_EARLY,
      confirmOutsideOpening: false,
    });
    await setRosterWeek(
      db,
      f.users.ana,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-16",
        days: week({ mon: [S("12:00", "20:00")], tue: [] }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    const ana = memberOf(await getRosterWeek(db, f.users.ana, "2026-11-16", NOW), f.members.ana);
    expect(ana.days.slice(0, 3).map((d) => [d.source, d.entries])).toEqual([
      ["planned", [S("12:00", "20:00")]],
      ["planned", []],
      ["usual", EARLY],
    ]);
  });

  it("clearing the usual week (null) shows Ana none on every unplanned day", async () => {
    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: MON_FRI_EARLY,
      confirmOutsideOpening: false,
    });
    await seedRow(f.members.ana, "2026-11-18", EARLY);
    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: null,
      confirmOutsideOpening: false,
    });
    const ana = memberOf(await getRosterWeek(db, f.users.olga, "2026-11-16", NOW), f.members.ana);
    expect(ana.usualWeek).toBeNull();
    expect(ana.days.map((d) => d.source)).toEqual([
      "none",
      "none",
      "planned",
      "none",
      "none",
      "none",
      "none",
    ]);
  });

  it("usual week: a bad week is bad_roster; outside the opening hours needs the confirmation", async () => {
    const run = (usualWeek: WeekHours | null, confirmOutsideOpening = false) =>
      outcome(setUsualWeek(db, f.users.olga, { memberId: f.members.ana, usualWeek, confirmOutsideOpening }));
    expect(await run({ ...MON_FRI_EARLY, sun: undefined } as unknown as WeekHours)).toBe("bad_roster");
    expect(await run({ ...MON_FRI_EARLY, mon: [S("15:00", "07:00")] })).toBe("bad_roster");
    const saturday = { ...MON_FRI_EARLY, sat: [S("06:00", "13:00")] };
    expect(await run(saturday)).toBe("outside_opening");
    expect(await run(saturday, true)).toBe("ok");
    // Unchanged Saturday, changed Monday inside the hours: no new confirmation needed.
    expect(await run({ ...saturday, mon: [S("08:00", "16:00")] })).toBe("ok");
  });

  it("reads: any access may read (staff included); edit rights follow H3", async () => {
    const asAna = await getRosterWeek(db, f.users.ana, "2026-11-16", NOW);
    expect(asAna.canEditUsualWeek).toBe(false);
    expect(asAna.editableMemberIds).toEqual([f.members.ana]);
    const asRok = await getRosterWeek(db, f.users.rok, "2026-11-16", NOW);
    expect(asRok.canEditUsualWeek).toBe(false);
    expect(asRok.editableMemberIds).toEqual([]);
    expect(asRok.members).toHaveLength(5);
    const asZala = await getRosterWeek(db, f.users.zala, "2026-11-16", NOW);
    expect(asZala.members.map((m) => m.memberId)).toEqual([f.members.zala, f.members.bea]);
  });

  it("reads take any Monday (past included); a non-Monday is bad_roster; no access is forbidden", async () => {
    expect(await outcome(getRosterWeek(db, f.users.olga, "2020-01-06", NOW))).toBe("ok");
    expect(await outcome(getRosterWeek(db, f.users.olga, "2026-11-10", NOW))).toBe("bad_roster");
    expect(await outcome(getRosterWeek(db, f.users.olga, "2026-13-01", NOW))).toBe("bad_roster");
    expect(await outcome(getRosterWeek(db, f.users.dan, "2026-11-16", NOW))).toBe("forbidden");
    expect(await outcome(getRosterWeek(db, f.users.cene, "2026-11-16", NOW))).toBe("forbidden");
  });

  it("readUsualWeek: null, undefined and Prisma.DbNull are no usual week", () => {
    expect(readUsualWeek(null)).toBeNull();
    expect(readUsualWeek(undefined)).toBeNull();
    expect(readUsualWeek(Prisma.DbNull)).toBeNull();
    // Prismock stores a written Prisma.DbNull as a plain {} (measured): also no usual week.
    expect(readUsualWeek({})).toBeNull();
    expect(readUsualWeek(MON_FRI_EARLY)).toEqual(MON_FRI_EARLY);
    expect(() => readUsualWeek({ mon: [] })).toThrow();
    expect(() => readUsualWeek([])).toThrow();
  });
});

describe("copyRosterWeek (G5)", () => {
  async function planAnaSourceWeek() {
    await setRosterWeek(
      db,
      f.users.olga,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ mon: EARLY, tue: [] }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    await seedRow(f.members.ana, "2026-11-18", EARLY);
  }

  it("makes the target week equal to the source week (unplanned source day deletes the target row)", async () => {
    await planAnaSourceWeek();
    const result = await copyRosterWeek(
      db,
      f.users.olga,
      { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16", memberIds: null },
      NOW
    );
    expect(result.copiedMemberIds).toEqual([f.members.olga, f.members.ana, f.members.bor, f.members.cene]);
    expect(result.copiedMemberIds).not.toContain(f.members.dan);
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-11-09", shifts: EARLY },
      { date: "2026-11-10", shifts: [] },
      { date: "2026-11-16", shifts: EARLY },
      { date: "2026-11-17", shifts: [] },
    ]);
    const ana = memberOf(await getRosterWeek(db, f.users.olga, "2026-11-16", NOW), f.members.ana);
    expect(ana.days.slice(0, 3).map((d) => [d.source, d.entries])).toEqual([
      ["planned", EARLY],
      ["planned", []],
      ["none", []],
    ]);
  });

  it("copy onto the current week (NOW = Saturday 11-07) leaves its past days exactly as they were", async () => {
    const LATE = [S("12:00", "20:00")];
    await seedRow(f.members.ana, "2026-11-03", LATE);
    await seedRow(f.members.ana, "2026-11-06", LATE);
    await seedRow(f.members.ana, "2026-11-08", LATE);
    // Source week 10-26: Tuesday, Friday and Saturday planned, Sunday not.
    await seedRow(f.members.ana, "2026-10-27", EARLY);
    await seedRow(f.members.ana, "2026-10-30", EARLY);
    await seedRow(f.members.ana, "2026-10-31", EARLY);
    await copyRosterWeek(
      db,
      f.users.olga,
      { fromWeekStart: "2026-10-26", toWeekStart: "2026-11-02", memberIds: [f.members.ana] },
      NOW
    );
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-10-27", shifts: EARLY },
      { date: "2026-10-30", shifts: EARLY },
      { date: "2026-10-31", shifts: EARLY },
      { date: "2026-11-03", shifts: LATE },
      { date: "2026-11-06", shifts: LATE },
      { date: "2026-11-07", shifts: EARLY },
    ]);
  });

  it("an explicit list is deduplicated and processed in ascending id order", async () => {
    const result = await copyRosterWeek(
      db,
      f.users.olga,
      {
        fromWeekStart: "2026-11-09",
        toWeekStart: "2026-11-16",
        memberIds: [f.members.bor, f.members.ana, f.members.ana],
      },
      NOW
    );
    expect(result.copiedMemberIds).toEqual([f.members.ana, f.members.bor]);
    expect(f.members.ana).toBeLessThan(f.members.bor);
  });

  it("a worker copying all copies only herself", async () => {
    await planAnaSourceWeek();
    await seedRow(f.members.bor, "2026-11-16", EARLY);
    const result = await copyRosterWeek(
      db,
      f.users.ana,
      { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16", memberIds: null },
      NOW
    );
    expect(result.copiedMemberIds).toEqual([f.members.ana]);
    expect(await rowsOf(f.members.bor)).toEqual([{ date: "2026-11-16", shifts: EARLY }]);
  });

  it("an explicit list: every id must be editable, else forbidden for the whole call and nothing written", async () => {
    await planAnaSourceWeek();
    const copy = (actor: number, memberIds: number[] | null) =>
      outcome(
        copyRosterWeek(db, actor, { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16", memberIds }, NOW)
      );
    expect(await copy(f.users.rok, null)).toBe("forbidden");
    expect(await copy(f.users.rok, [f.members.ana])).toBe("forbidden");
    expect(await copy(f.users.olga, [f.members.ana, f.members.bea])).toBe("forbidden");
    expect(await copy(f.users.olga, [f.members.ana, 999999])).toBe("forbidden");
    expect(await copy(f.users.olga, [f.members.ana, f.members.rok])).toBe("forbidden");
    expect(await copy(f.users.ana, [f.members.bor])).toBe("forbidden");
    expect(await copy(f.users.dan, null)).toBe("forbidden");
    // Nothing written for Ana: her 2026-11-18 row is still there and 11-16/11-17 were not created.
    expect((await rowsOf(f.members.ana)).map((r) => r.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-18",
    ]);
  });

  it("an explicit list copies a LOCKED member (the owner may plan one)", async () => {
    await seedRow(f.members.dan, "2026-11-09", EARLY);
    const result = await copyRosterWeek(
      db,
      f.users.olga,
      { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16", memberIds: [f.members.dan] },
      NOW
    );
    expect(result.copiedMemberIds).toEqual([f.members.dan]);
    expect((await rowsOf(f.members.dan)).map((r) => r.date)).toEqual(["2026-11-09", "2026-11-16"]);
  });

  it("weeks: Mondays only, different, the window applies to the target only", async () => {
    const copy = (fromWeekStart: string, toWeekStart: string) =>
      outcome(copyRosterWeek(db, f.users.olga, { fromWeekStart, toWeekStart, memberIds: null }, NOW));
    await seedRow(f.members.ana, "2026-10-27", EARLY);
    expect(await copy("2026-10-26", "2026-11-16")).toBe("ok");
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-10-27", shifts: EARLY },
      { date: "2026-11-17", shifts: EARLY },
    ]);
    expect(await copy("2026-11-09", "2026-10-26")).toBe("week_out_of_range");
    expect(await copy("2026-11-09", "2027-11-15")).toBe("week_out_of_range");
    expect(await copy("2026-11-16", "2026-11-16")).toBe("same_week");
    expect(await copy("2026-11-10", "2026-11-16")).toBe("bad_roster");
    expect(await copy("2026-11-09", "2026-11-17")).toBe("bad_roster");
    expect(await copy("2026-11-09", "nope")).toBe("bad_roster");
  });

  it("the opening cap is not re-checked on copy", async () => {
    await setRosterWeek(
      db,
      f.users.olga,
      {
        memberId: f.members.ana,
        weekStart: "2026-11-09",
        days: week({ sun: [S("09:00", "12:00")] }),
        confirmOutsideOpening: true,
      },
      NOW
    );
    const result = await copyRosterWeek(
      db,
      f.users.olga,
      { fromWeekStart: "2026-11-09", toWeekStart: "2026-11-16", memberIds: [f.members.ana] },
      NOW
    );
    expect(result.copiedMemberIds).toEqual([f.members.ana]);
    expect((await rowsOf(f.members.ana)).map((r) => r.date)).toEqual(["2026-11-15", "2026-11-22"]);
  });
});

describe("absences (H2)", () => {
  const add = (actor: number, memberId: number, startDate: string, endDate: string) =>
    outcome(addAbsence(db, actor, { memberId, startDate, endDate }, NOW));

  it("an absence across the year marks the days absent in both weeks and survives a copy", async () => {
    const created = await addAbsence(
      db,
      f.users.ana,
      { memberId: f.members.ana, startDate: "2026-12-24", endDate: "2027-01-03" },
      NOW
    );
    expect(created.absenceId).toEqual(expect.any(Number));
    const stored = await prismock.flowkoAbsence.findUnique({ where: { id: created.absenceId } });
    expect(stored).toMatchObject({ memberId: f.members.ana, createdByUserId: f.users.ana });
    expect(iso(stored?.startDate as Date)).toBe("2026-12-24");
    expect(iso(stored?.endDate as Date)).toBe("2027-01-03");

    const before = memberOf(await getRosterWeek(db, f.users.olga, "2026-12-21", NOW), f.members.ana);
    expect(before.days.map((d) => d.absent)).toEqual([false, false, false, true, true, true, true]);
    expect(before.absences).toEqual([
      { id: created.absenceId, startDate: "2026-12-24", endDate: "2027-01-03" },
    ]);
    const next = memberOf(await getRosterWeek(db, f.users.olga, "2026-12-28", NOW), f.members.ana);
    expect(next.days.map((d) => d.absent)).toEqual(Array(7).fill(true));
    expect(memberOf(await getRosterWeek(db, f.users.olga, "2027-01-04", NOW), f.members.ana).absences).toEqual([]);

    await setRosterWeek(
      db,
      f.users.olga,
      {
        memberId: f.members.ana,
        weekStart: "2026-12-21",
        days: week({ mon: EARLY }),
        confirmOutsideOpening: false,
      },
      NOW
    );
    await copyRosterWeek(
      db,
      f.users.olga,
      { fromWeekStart: "2026-12-21", toWeekStart: "2026-12-28", memberIds: null },
      NOW
    );
    const copied = memberOf(await getRosterWeek(db, f.users.olga, "2026-12-28", NOW), f.members.ana);
    expect(copied.days[0]).toEqual({ date: "2026-12-28", source: "planned", entries: EARLY, absent: true });
    expect(await prismock.flowkoAbsence.count({ where: { memberId: f.members.ana } })).toBe(1);
  });

  it("date rules: order, end not before today, span ≤ 365 days, start ≤ today + 371", async () => {
    expect(await add(f.users.ana, f.members.ana, "2026-11-12", "2026-11-11")).toBe("bad_absence");
    expect(await add(f.users.ana, f.members.ana, "2026-11-01", "2026-11-06")).toBe("bad_absence");
    expect(await add(f.users.ana, f.members.ana, "2026-11-01", "2026-11-07")).toBe("ok"); // ends today
    expect(await add(f.users.ana, f.members.ana, "2027-11-14", "2027-11-14")).toBe("bad_absence");
    expect(await add(f.users.ana, f.members.ana, "2027-11-13", "2027-11-13")).toBe("ok");
    expect(await add(f.users.ana, f.members.ana, "2026-11-31", "2026-12-01")).toBe("bad_absence");
    expect(await add(f.users.ana, f.members.ana, "2026-11-10", "x")).toBe("bad_absence");

    const create = vi.spyOn(prismock.flowkoAbsence, "create");
    expect(await add(f.users.ana, f.members.ana, "2026-11-10", "2027-11-11")).toBe("bad_absence"); // 366 apart
    expect(create).not.toHaveBeenCalled();
    expect(await add(f.users.ana, f.members.ana, "2026-11-10", "2027-11-10")).toBe("ok"); // 365 apart
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("overlapping absences of one member are allowed", async () => {
    expect(await add(f.users.ana, f.members.ana, "2026-11-20", "2026-11-25")).toBe("ok");
    expect(await add(f.users.ana, f.members.ana, "2026-11-22", "2026-11-30")).toBe("ok");
    expect(await prismock.flowkoAbsence.count({ where: { memberId: f.members.ana } })).toBe(2);
  });

  it("removeAbsence: own or as owner; a colleague's, a missing or a foreign one is forbidden; history stays", async () => {
    const anaAbsence = await addAbsence(
      db,
      f.users.ana,
      { memberId: f.members.ana, startDate: "2026-11-20", endDate: "2026-11-21" },
      NOW
    );
    const borAbsence = await addAbsence(
      db,
      f.users.bor,
      { memberId: f.members.bor, startDate: "2026-11-20", endDate: "2026-11-21" },
      NOW
    );
    const beaAbsence = await addAbsence(
      db,
      f.users.bea,
      { memberId: f.members.bea, startDate: "2026-11-20", endDate: "2026-11-21" },
      NOW
    );
    const past = await prismock.flowkoAbsence.create({
      data: { memberId: f.members.ana, startDate: day("2026-10-20"), endDate: day("2026-11-06") },
    });

    expect(await outcome(removeAbsence(db, f.users.ana, borAbsence.absenceId, NOW))).toBe("forbidden");
    expect(await outcome(removeAbsence(db, f.users.ana, 999999, NOW))).toBe("forbidden");
    expect(await outcome(removeAbsence(db, f.users.olga, beaAbsence.absenceId, NOW))).toBe("forbidden");
    expect(await outcome(removeAbsence(db, f.users.rok, anaAbsence.absenceId, NOW))).toBe("forbidden");
    expect(await outcome(removeAbsence(db, f.users.ana, past.id, NOW))).toBe("bad_absence");
    expect(await outcome(removeAbsence(db, f.users.olga, past.id, NOW))).toBe("bad_absence");
    expect(await prismock.flowkoAbsence.findUnique({ where: { id: past.id } })).not.toBeNull();

    expect(await outcome(removeAbsence(db, f.users.ana, anaAbsence.absenceId, NOW))).toBe("ok");
    expect(await outcome(removeAbsence(db, f.users.olga, borAbsence.absenceId, NOW))).toBe("ok");
    expect(await prismock.flowkoAbsence.findUnique({ where: { id: anaAbsence.absenceId } })).toBeNull();
    expect(await prismock.flowkoAbsence.findUnique({ where: { id: borAbsence.absenceId } })).toBeNull();
  });
});

describe("holiday settings (H1)", () => {
  async function openHolidaysOf(businessId: number): Promise<string[]> {
    const b = await prismock.flowkoBusiness.findUnique({ where: { id: businessId } });
    return b?.openHolidays ?? [];
  }

  it("owner only", async () => {
    expect(await outcome(setHolidaysClosed(db, f.users.ana, false))).toBe("forbidden");
    expect(await outcome(setHolidaysClosed(db, f.users.rok, false))).toBe("forbidden");
    expect(await outcome(setHolidaysClosed(db, f.users.dan, false))).toBe("forbidden");
    expect(await outcome(setHolidayOpen(db, f.users.ana, { date: "2026-12-25", open: true }, NOW))).toBe(
      "forbidden"
    );
    expect(await outcome(setHolidayOpen(db, f.users.rok, { date: "2026-12-25", open: true }, NOW))).toBe(
      "forbidden"
    );
  });

  it("opening one holiday: not_a_holiday, shown open, no duplicate, removed again", async () => {
    expect(await outcome(setHolidayOpen(db, f.users.olga, { date: "2026-12-24", open: true }, NOW))).toBe(
      "not_a_holiday"
    );
    const closed = await getRosterWeek(db, f.users.olga, "2026-12-21", NOW);
    expect(closed.holidaysClosed).toBe(true);
    expect(closed.days[4].holiday).toEqual({ name: "božič", open: false });
    expect(closed.days[5].holiday).toEqual({ name: "dan samostojnosti in enotnosti", open: false });
    expect(closed.days[3].holiday).toBeNull();

    await setHolidayOpen(db, f.users.olga, { date: "2026-12-25", open: true }, NOW);
    expect((await getRosterWeek(db, f.users.olga, "2026-12-21", NOW)).days[4].holiday).toEqual({
      name: "božič",
      open: true,
    });
    await setHolidayOpen(db, f.users.olga, { date: "2026-12-25", open: true }, NOW);
    expect(await openHolidaysOf(f.a)).toEqual(["2026-12-25"]);
    expect(await openHolidaysOf(f.b)).toEqual([]);
    await setHolidayOpen(db, f.users.olga, { date: "2026-12-25", open: false }, NOW);
    expect(await openHolidaysOf(f.a)).toEqual([]);
  });

  it("window: today … today + 371; past dates are dropped on every write", async () => {
    const open = (date: string) => outcome(setHolidayOpen(db, f.users.olga, { date, open: true }, NOW));
    expect(await open("2026-11-01")).toBe("bad_roster"); // past holiday
    expect(await open("2027-12-25")).toBe("bad_roster"); // after today + 371
    expect(await open("2026-12-32")).toBe("bad_roster");
    await prismock.flowkoBusiness.update({
      where: { id: f.a },
      data: { openHolidays: ["2026-01-01", "2026-12-25"] },
    });
    expect(await open("2027-01-01")).toBe("ok");
    expect(await openHolidaysOf(f.a)).toEqual(["2026-12-25", "2027-01-01"]);
  });

  it("switching holidays off opens every holiday; on closes them again", async () => {
    await setHolidaysClosed(db, f.users.olga, false);
    const view = await getRosterWeek(db, f.users.olga, "2026-12-21", NOW);
    expect(view.holidaysClosed).toBe(false);
    expect(view.days[4].holiday).toEqual({ name: "božič", open: true });
    await setHolidaysClosed(db, f.users.olga, true);
    expect((await getRosterWeek(db, f.users.olga, "2026-12-21", NOW)).days[4].holiday?.open).toBe(false);
  });

  it("a missing openHolidays (SQL NULL) is read as []", async () => {
    await prismock.flowkoBusiness.update({ where: { id: f.a }, data: { openHolidays: undefined } });
    await prismock.flowkoBusiness.update({
      where: { id: f.a },
      data: { openHolidays: null as unknown as [] },
    });
    expect((await getRosterWeek(db, f.users.olga, "2026-12-21", NOW)).days[4].holiday?.open).toBe(false);
    await setHolidayOpen(db, f.users.olga, { date: "2026-12-25", open: true }, NOW);
    expect(await openHolidaysOf(f.a)).toEqual(["2026-12-25"]);
  });
});

describe("getRosterWeek: today, window and versions (U29b S2)", () => {
  // NOW_MON = Mon 2026-11-16 08:07 in Ljubljana; the write window ends on the last Monday <= today + 371.
  const NOW_MON = new Date("2026-11-16T07:07:00Z");

  it("answers today in the business time zone and the last writable Monday", async () => {
    const view = await getRosterWeek(db, f.users.olga, "2026-11-16", NOW_MON);
    expect(view.today).toBe("2026-11-16");
    expect(view.lastWritableWeekStart).toBe("2027-11-22");
    // 23:30Z on Sunday is already Monday in Ljubljana; the window bound moves with it.
    const late = await getRosterWeek(db, f.users.olga, "2026-11-16", new Date("2026-11-15T23:30:00Z"));
    expect(late.today).toBe("2026-11-16");
  });

  it("the last writable Monday is the last Monday <= today + 371, whatever weekday today is", async () => {
    const wed = await getRosterWeek(db, f.users.olga, "2026-11-16", new Date("2026-11-18T10:00:00Z"));
    expect(wed.today).toBe("2026-11-18");
    expect(wed.lastWritableWeekStart).toBe("2027-11-22"); // 18 Nov + 371 = Wed 24 Nov 2027
    const sun = await getRosterWeek(db, f.users.olga, "2026-11-16", new Date("2026-11-22T10:00:00Z"));
    expect(sun.lastWritableWeekStart).toBe("2027-11-22"); // 22 Nov + 371 = Sun 28 Nov 2027
    const tue = await getRosterWeek(db, f.users.olga, "2026-11-16", new Date("2026-11-17T10:00:00Z"));
    expect(tue.lastWritableWeekStart).toBe("2027-11-22"); // Tue 23 Nov 2027
  });

  it("per member weekVersion and usualVersion equal the hashes of the stored data", async () => {
    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: MON_FRI_EARLY,
      confirmOutsideOpening: false,
    });
    await seedRow(f.members.ana, "2026-11-17", [S("09:00", "12:00"), S("13:00", "17:00")]);
    await seedRow(f.members.ana, "2026-11-20", []);
    await seedRow(f.members.ana, "2026-11-30", EARLY); // another week: not in this week's hash

    const view = await getRosterWeek(db, f.users.olga, "2026-11-16", NOW_MON);
    const ana = memberOf(view, f.members.ana);
    expect(ana.weekVersion).toBe(
      weekVersionOf({
        status: "ACTIVE",
        usualWeek: MON_FRI_EARLY,
        rows: [
          ["2026-11-17", [S("09:00", "12:00"), S("13:00", "17:00")]],
          ["2026-11-20", []],
        ],
      })
    );
    expect(ana.usualVersion).toBe(usualVersionOf({ status: "ACTIVE", usualWeek: MON_FRI_EARLY }));

    const bor = memberOf(view, f.members.bor);
    expect(bor.weekVersion).toBe(weekVersionOf({ status: "ACTIVE", usualWeek: null, rows: [] }));
    expect(bor.usualVersion).toBe(usualVersionOf({ status: "ACTIVE", usualWeek: null }));
    const dan = memberOf(view, f.members.dan);
    expect(dan.usualVersion).toBe(usualVersionOf({ status: "LOCKED", usualWeek: null }));
  });

  it("a reset-to-usual (deleted row), a usual-week change and a lock change the version; an absence does not", async () => {
    await seedRow(f.members.ana, "2026-11-17", EARLY);
    const read = async () => memberOf(await getRosterWeek(db, f.users.olga, "2026-11-16", NOW_MON), f.members.ana);
    const v0 = await read();

    await prismock.flowkoRosterDay.deleteMany({ where: { memberId: f.members.ana } });
    const v1 = await read();
    expect(v1.weekVersion).not.toBe(v0.weekVersion);
    expect(v1.usualVersion).toBe(v0.usualVersion); // rows are not part of the usual version

    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: MON_FRI_EARLY,
      confirmOutsideOpening: false,
    });
    const v2 = await read();
    expect(v2.weekVersion).not.toBe(v1.weekVersion);
    expect(v2.usualVersion).not.toBe(v1.usualVersion);

    await addAbsence(db, f.users.olga, { memberId: f.members.ana, startDate: "2026-11-17", endDate: "2026-11-18" }, NOW_MON);
    const v3 = await read();
    expect(v3.weekVersion).toBe(v2.weekVersion);
    expect(v3.usualVersion).toBe(v2.usualVersion);

    await prismock.flowkoBusinessMember.update({
      where: { id: f.members.ana },
      data: { status: FlowkoMemberStatus.LOCKED },
    });
    const v4 = await read();
    expect(v4.weekVersion).not.toBe(v3.weekVersion);
    expect(v4.usualVersion).not.toBe(v3.usualVersion);
  });
});

describe("saveRosterWeek (U29b S3)", () => {
  // Flowko U29b: NOW_MON = Mon 2026-11-16 08:07 in Ljubljana; WEEK = the week of 16 Nov (Tue 17, Sat 21).
  // Prismock ignores the locks ($executeRaw); roster-save.integration-test.ts proves them on Postgres.
  const NOW_MON = new Date("2026-11-16T07:07:00Z");
  const WEEK = "2026-11-16";
  const TZ = "Europe/Ljubljana";
  const OFFICE = [S("08:00", "16:00")];
  const ANA_USUAL: WeekHours = {
    mon: OFFICE,
    tue: OFFICE,
    wed: OFFICE,
    thu: OFFICE,
    fri: OFFICE,
    sat: [],
    sun: [],
  };
  const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));

  async function versionOf(memberId: number, weekStart = WEEK, now = NOW_MON): Promise<string> {
    return memberOf(await getRosterWeek(db, f.users.olga, weekStart, now), memberId).weekVersion;
  }

  async function rowFor(memberId: number, days: WeekPlan, weekStart = WEEK, now = NOW_MON) {
    return { memberId, version: await versionOf(memberId, weekStart, now), days };
  }

  const save = (
    actorUserId: number,
    rows: Array<{ memberId: number; version: string; days: WeekPlan }>,
    confirm = false,
    weekStart = WEEK,
    now = NOW_MON
  ) => saveRosterWeek(db, actorUserId, { weekStart, rows, confirm }, now);

  async function anaBookingTue10(): Promise<number> {
    await setUsualWeek(db, f.users.olga, {
      memberId: f.members.ana,
      usualWeek: ANA_USUAL,
      confirmOutsideOpening: false,
    });
    const mirror = await ensureWorkerMirror(prismock as unknown as Prisma.TransactionClient, f.members.ana);
    const booking = await prismock.booking.create({
      data: {
        uid: `u29b-save-${seq}`,
        title: "Termin",
        startTime: at("2026-11-17", "10:00"),
        endTime: at("2026-11-17", "11:00"),
        eventTypeId: mirror.eventTypeId,
        userId: f.users.ana,
        status: BookingStatus.ACCEPTED,
      },
      select: { id: true },
    });
    return booking.id;
  }

  it("the owner saves Ana and Bor: both weeks stored, saved", async () => {
    const rows = [
      await rowFor(f.members.ana, week({ mon: EARLY, tue: [] })),
      await rowFor(f.members.bor, week({ wed: EARLY })),
    ];
    expect(await save(f.users.olga, rows)).toEqual({ status: "saved" });
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-11-16", shifts: EARLY },
      { date: "2026-11-17", shifts: [] },
    ]);
    expect(await rowsOf(f.members.bor)).toEqual([{ date: "2026-11-18", shifts: EARLY }]);
    const written = await prismock.flowkoRosterDay.findMany({ where: { memberId: f.members.bor } });
    expect(written.map((r) => r.updatedByUserId)).toEqual([f.users.olga]);
  });

  it("a worker saves her own row; the version answered by the read is accepted again after the save", async () => {
    const first = await rowFor(f.members.ana, week({ thu: EARLY }));
    expect(await save(f.users.ana, [first])).toEqual({ status: "saved" });
    const second = await rowFor(f.members.ana, week({ thu: [] }));
    expect(await save(f.users.ana, [second])).toEqual({ status: "saved" });
    expect(await rowsOf(f.members.ana)).toEqual([{ date: "2026-11-19", shifts: [] }]);
  });

  it("Review Focus 1: a refused row (colleague, staff, foreign, missing) is forbidden and nothing is written", async () => {
    const ana = await rowFor(f.members.ana, week({ mon: EARLY }));
    const bor = await rowFor(f.members.bor, week({ mon: EARLY }));
    const bea = { memberId: f.members.bea, version: ana.version, days: week({ mon: EARLY }) };
    const missing = { memberId: 999999, version: ana.version, days: week({ mon: EARLY }) };
    // A worker with her own row and a colleague's: the own row (lower id) passes, the colleague's refuses all.
    expect(await outcome(save(f.users.ana, [ana, bor]))).toBe("forbidden");
    expect(await outcome(save(f.users.ana, [bor]))).toBe("forbidden");
    expect(await outcome(save(f.users.rok, [ana]))).toBe("forbidden"); // STAFF
    expect(await outcome(save(f.users.zala, [ana]))).toBe("forbidden"); // owner of B, member of A
    expect(await outcome(save(f.users.olga, [ana, bea]))).toBe("forbidden"); // owner of A, member of B
    expect(await outcome(save(f.users.olga, [ana, missing]))).toBe("forbidden");
    expect(await outcome(save(f.users.dan, [ana]))).toBe("forbidden"); // LOCKED login: no access
    expect(await rowsOf(f.members.ana)).toEqual([]);
    expect(await rowsOf(f.members.bor)).toEqual([]);
    expect(await rowsOf(f.members.bea)).toEqual([]);
  });

  it("bad_roster: no rows, more than 50, a duplicate member, 5 entries in a day, unsorted entries, a non-Monday", async () => {
    const ana = await rowFor(f.members.ana, week({ mon: EARLY }));
    const five = [
      S("08:00", "09:00"),
      S("09:30", "10:00"),
      S("10:30", "11:00"),
      S("11:30", "12:00"),
      S("13:00", "14:00"),
    ];
    const four = five.slice(0, 4);
    expect(await outcome(save(f.users.olga, []))).toBe("bad_roster");
    expect(await outcome(save(f.users.olga, Array(51).fill(ana)))).toBe("bad_roster");
    const twice = { ...ana, days: week({ tue: EARLY }) };
    expect(await outcome(save(f.users.olga, [ana, twice]))).toBe("bad_roster");
    expect(await outcome(save(f.users.olga, [{ ...ana, days: week({ mon: five }) }]))).toBe("bad_roster");
    const unsorted = [S("13:00", "14:00"), S("08:00", "09:00")];
    expect(await outcome(save(f.users.olga, [{ ...ana, days: week({ mon: unsorted }) }]))).toBe("bad_roster");
    expect(await outcome(save(f.users.olga, [{ ...ana, days: { ...week(), extra: [] } as WeekPlan }]))).toBe(
      "bad_roster"
    );
    const numericVersion = { ...ana, version: 7 as unknown as string };
    expect(await outcome(save(f.users.olga, [numericVersion]))).toBe("bad_roster");
    expect(await outcome(save(f.users.olga, [ana], false, "2026-11-17"))).toBe("bad_roster");
    expect(await rowsOf(f.members.ana)).toEqual([]);
    // Four entries are the most a day takes.
    expect(await save(f.users.olga, [{ ...ana, days: week({ mon: four }) }])).toEqual({ status: "saved" });
  });

  it("week_out_of_range: a past week and a week beyond the window; the last writable Monday is accepted", async () => {
    const past = await rowFor(f.members.ana, week({ mon: EARLY }), "2026-11-09");
    expect(await outcome(save(f.users.olga, [past], false, "2026-11-09"))).toBe("week_out_of_range");
    const beyond = await rowFor(f.members.ana, week({ mon: EARLY }), "2027-11-29");
    expect(await outcome(save(f.users.olga, [beyond], false, "2027-11-29"))).toBe("week_out_of_range");
    expect(await rowsOf(f.members.ana)).toEqual([]);
    const last = await rowFor(f.members.ana, week({ mon: EARLY }), "2027-11-22");
    expect(await save(f.users.olga, [last], false, "2027-11-22")).toEqual({ status: "saved" });
  });

  it("a stale version is roster_changed and nothing is written, not even the fresh rows", async () => {
    const staleAna = await rowFor(f.members.ana, week({ mon: EARLY }));
    expect(await save(f.users.olga, [await rowFor(f.members.ana, week({ tue: EARLY }))])).toEqual({
      status: "saved",
    });
    const freshBor = await rowFor(f.members.bor, week({ wed: EARLY }));
    expect(await outcome(save(f.users.olga, [staleAna, freshBor]))).toBe("roster_changed");
    expect(await rowsOf(f.members.ana)).toEqual([{ date: "2026-11-17", shifts: EARLY }]);
    expect(await rowsOf(f.members.bor)).toEqual([]);
    // A version that was never answered never matches.
    expect(await outcome(save(f.users.olga, [{ ...freshBor, version: "" }]))).toBe("roster_changed");
    expect(await rowsOf(f.members.bor)).toEqual([]);
  });

  it("days before today are never written (now = Wed 18 Nov 08:00): Mon/Tue keep their rows, Wed follows", async () => {
    const WED = new Date("2026-11-18T07:00:00Z");
    await seedRow(f.members.ana, "2026-11-16", EARLY);
    await seedRow(f.members.ana, "2026-11-17", []);
    const LATE = [S("12:00", "20:00")];
    const row = await rowFor(f.members.ana, week({ mon: LATE, tue: LATE, wed: LATE }), WEEK, WED);
    expect(await save(f.users.olga, [row], false, WEEK, WED)).toEqual({ status: "saved" });
    expect(await rowsOf(f.members.ana)).toEqual([
      { date: "2026-11-16", shifts: EARLY },
      { date: "2026-11-17", shifts: [] },
      { date: "2026-11-18", shifts: LATE },
    ]);
    // A past day outside the opening hours asks for nothing (it is not written).
    const early = [S("05:00", "06:00")];
    const pastOutside = await rowFor(f.members.ana, week({ mon: early, wed: LATE }), WEEK, WED);
    expect(await save(f.users.olga, [pastOutside], false, WEEK, WED)).toEqual({ status: "saved" });
    expect((await rowsOf(f.members.ana))[0]).toEqual({ date: "2026-11-16", shifts: EARLY });
  });

  it("Review Focus 3: Tue 13–17 leaves Ana's Tue 10:00 booking newly outside → needs_confirm, nothing written", async () => {
    const bookingId = await anaBookingTue10();
    const before = await prismock.booking.findUnique({ where: { id: bookingId } });
    const ana = await rowFor(f.members.ana, week({ tue: [S("13:00", "17:00")] }));
    const bor = await rowFor(f.members.bor, week({ tue: EARLY })); // nothing to report: not in the warnings
    expect(await save(f.users.olga, [ana, bor])).toEqual({
      status: "needs_confirm",
      warnings: [{ memberId: f.members.ana, outsideOpening: [], bookingsNewlyOutside: 1 }],
    });
    expect(await rowsOf(f.members.ana)).toEqual([]);
    expect(await rowsOf(f.members.bor)).toEqual([]);

    expect(await save(f.users.olga, [ana, bor], true)).toEqual({ status: "saved" });
    expect(await rowsOf(f.members.ana)).toEqual([{ date: "2026-11-17", shifts: [S("13:00", "17:00")] }]);
    expect(await rowsOf(f.members.bor)).toEqual([{ date: "2026-11-17", shifts: EARLY }]);
    expect(await prismock.booking.findUnique({ where: { id: bookingId } })).toEqual(before);
  });

  it("Review Focus 3: Tue 09–12 keeps the booking inside → saved without a question", async () => {
    await anaBookingTue10();
    const ana = await rowFor(f.members.ana, week({ tue: [S("09:00", "12:00")] }));
    expect(await save(f.users.olga, [ana])).toEqual({ status: "saved" });
  });

  it("Ana Sat 21 Nov 09–12 with Saturday closed → needs_confirm with the date, nothing written", async () => {
    const business = await prismock.flowkoBusiness.findUnique({ where: { id: f.a } });
    const hours = business?.openingHours as Record<string, unknown>;
    await prismock.flowkoBusiness.update({
      where: { id: f.a },
      data: { openingHours: { ...hours, sat: [] } },
    });
    const ana = await rowFor(f.members.ana, week({ sat: [S("09:00", "12:00")] }));
    expect(await save(f.users.olga, [ana])).toEqual({
      status: "needs_confirm",
      warnings: [{ memberId: f.members.ana, outsideOpening: ["2026-11-21"], bookingsNewlyOutside: 0 }],
    });
    expect(await rowsOf(f.members.ana)).toEqual([]);
  });

  it("rosterTx: a deadlock (P2010 with meta code 40P01) is roster_conflict; any other P2010 is rethrown", async () => {
    const raw = (code: string) =>
      new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${code}\``, {
        code: "P2010",
        clientVersion: "6",
        meta: { code, message: "deadlock detected" },
      });
    // The pg driver-adapter form, as Postgres 16 raised it for two crossed advisory locks (measured in Task 3).
    const adapter = new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `40P01`", {
      code: "P2010",
      clientVersion: "6",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { originalCode: "40P01", kind: "postgres", code: "40P01", message: "deadlock detected" },
        },
      },
    });
    const row = await rowFor(f.members.ana, week({ mon: EARLY }));
    vi.spyOn(prismock.flowkoRosterDay, "createMany").mockRejectedValueOnce(raw("40P01"));
    expect(await outcome(save(f.users.olga, [row]))).toBe("roster_conflict");
    vi.spyOn(prismock.flowkoRosterDay, "createMany").mockRejectedValueOnce(adapter);
    expect(await outcome(save(f.users.olga, [row]))).toBe("roster_conflict");
    const other = raw("22P02");
    vi.spyOn(prismock.flowkoRosterDay, "createMany").mockRejectedValueOnce(other);
    await expect(save(f.users.olga, [row])).rejects.toBe(other);
  });
});
