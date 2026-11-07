// Flowko U26: loadBusinessDay feeds the U24 engine (prismock). Business A (owner Olga without a usual week, login
// workers Ana 07-15 and Bor 12-20, desk-only Cene 07-20 absent on 2026-11-17, staff Rok, locked worker Dan) and B
// (owner Zala, worker Bea). The tests run the loaded shifts and time off through the real U24 freeStarts and
// explainFit with the hair-salon template's services (Moško striženje 30 min busy; Barvanje busy 30 / processing
// 40 / busy 30). NOW = 2026-11-07T12:00:00Z; the roster services run on the same fixture style as roster.test.ts.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; roster.ts takes `db` and never imports it.
import "@calcom/prisma";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { getFlowkoTemplate } from "@calcom/lib/flowkoBusiness/templates";
import {
  explainFit,
  freeStarts,
  type Ms,
  type ServiceStep,
  wallClockToMs,
  type WorkerDay,
} from "@calcom/lib/flowkoSalon";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it } from "vitest";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { addAbsence, type LoadedBusinessDay, loadBusinessDay, setHolidayOpen, setUsualWeek } from "./roster";

const db = prismock as unknown as FlowkoDb;
const NOW = new Date("2026-11-07T12:00:00Z");
const TZ = "Europe/Ljubljana";
let seq = 0;

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

const template = getFlowkoTemplate("hair-salon");
if (!template) throw new Error("fixture: hair-salon template missing");
const stepsOf = (name: string): ServiceStep[] => {
  const service = template.services.find((s) => s.name === name);
  if (!service) throw new Error(`fixture: service ${name} missing`);
  return service.steps;
};
const MENS_CUT = stepsOf("Moško striženje");
const COLOURING = stepsOf("Barvanje");

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

type Who = "olga" | "ana" | "bor" | "cene" | "rok" | "dan" | "zala" | "bea";
type Fixture = { a: number; b: number; users: Record<Who, number>; members: Record<Who, number> };

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `engine-a-${seq}`,
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
    slug: `engine-b-${seq}`,
    templateId: "hair-salon",
  });
  await prismock.flowkoBusiness.update({ where: { id: createdB.businessId }, data: { openHolidays: [] } });
  const bea = await makeUser("Bea");
  const beaMember = await addLoginMember(db, createdB.businessId, bea, FlowkoBusinessRole.WORKER);

  const fixture: Fixture = {
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

  const usual = (who: Who, hours: ShiftEntry[]) =>
    setUsualWeek(db, olga, {
      memberId: fixture.members[who],
      usualWeek: week(hours),
      confirmOutsideOpening: false,
    });
  await usual("ana", [{ from: "07:00", to: "15:00" }]);
  await usual("bor", [{ from: "12:00", to: "20:00" }]);
  await usual("cene", [{ from: "07:00", to: "20:00" }]);
  // Dan is locked and Bea belongs to B: both have shifts that must never show up in A's day.
  await prismock.flowkoBusinessMember.update({
    where: { id: fixture.members.dan },
    data: { usualWeek: week([{ from: "07:00", to: "20:00" }]) },
  });
  await prismock.flowkoBusinessMember.update({
    where: { id: fixture.members.bea },
    data: { usualWeek: week([{ from: "08:00", to: "16:00" }]) },
  });
  await addAbsence(
    db,
    olga,
    { memberId: fixture.members.cene, startDate: "2026-11-17", endDate: "2026-11-17" },
    NOW
  );
  return fixture;
}

let f: Fixture;
beforeEach(async () => {
  f = await setUp();
});

/** The U24 inputs of a loaded worker: no bookings, no external busy time. */
const workerDay = (w: LoadedBusinessDay["workers"][number]): WorkerDay => ({
  shifts: w.shifts,
  timeOff: w.timeOff,
  bookings: [],
  externalBusy: [],
});
const rulesOf = (loaded: LoadedBusinessDay) => ({ ...loaded.rules, minimumNoticeMinutes: 0, now: 0 });
const workerOf = (loaded: LoadedBusinessDay, memberId: number) => {
  const w = loaded.workers.find((x) => x.memberId === memberId);
  if (!w) throw new Error("fixture: worker not loaded");
  return w;
};
const startsOf = (loaded: LoadedBusinessDay, memberId: number, steps: ServiceStep[]): Ms[] =>
  freeStarts(workerDay(workerOf(loaded, memberId)), steps, rulesOf(loaded));
const at = (date: string, time: string): Ms => wallClockToMs(date, time, TZ);

describe("loadBusinessDay: who is loaded", () => {
  it("loads the active owner and workers in position order, without locked or staff members", async () => {
    const loaded = await loadBusinessDay(db, f.a, "2026-11-17");
    expect(loaded.businessId).toBe(f.a);
    expect(loaded.date).toBe("2026-11-17");
    expect(loaded.workers.map((w) => w.memberId)).toEqual([
      f.members.olga,
      f.members.ana,
      f.members.bor,
      f.members.cene,
    ]);
    expect(loaded.workers.map((w) => w.displayName)).toEqual(["Olga", "Ana", "Bor", "Cene"]);
    expect(loaded.workers.map((w) => w.userId)).toEqual([
      f.users.olga,
      f.users.ana,
      f.users.bor,
      f.users.cene,
    ]);
    expect(loaded.workers.map((w) => w.memberId)).not.toContain(f.members.dan);
    expect(loaded.workers.map((w) => w.memberId)).not.toContain(f.members.rok);
  });

  it("business B returns only B's workers", async () => {
    const loaded = await loadBusinessDay(db, f.b, "2026-11-17");
    expect(loaded.businessId).toBe(f.b);
    expect(loaded.workers.map((w) => w.memberId)).toEqual([f.members.zala, f.members.bea]);
    expect(startsOf(loaded, f.members.bea, MENS_CUT)[0]).toBe(at("2026-11-17", "08:00"));
  });

  it("throws when a column member has no user (never silently skipped)", async () => {
    await prismock.flowkoBusinessMember.update({ where: { id: f.members.ana }, data: { userId: null } });
    await expect(loadBusinessDay(db, f.a, "2026-11-17")).rejects.toThrow(
      "Flowko U26: column member without user"
    );
  });
});

describe("loadBusinessDay: the day through the U24 engine", () => {
  it("opens the day with the business rules and the workers' shifts and time off", async () => {
    const loaded = await loadBusinessDay(db, f.a, "2026-11-17");
    expect(loaded.holiday).toBeNull();
    expect(loaded.rules.slotStepMinutes).toBe(15);
    expect(loaded.rules.opening).toEqual([
      { start: at("2026-11-17", "07:00"), end: at("2026-11-17", "20:00") },
    ]);
    expect(loaded.rules.day.end - loaded.rules.day.start).toBe(24 * 3_600_000);
    expect(workerOf(loaded, f.members.olga).shifts).toEqual([]);
    expect(workerOf(loaded, f.members.ana).shifts).toEqual([
      { start: at("2026-11-17", "07:00"), end: at("2026-11-17", "15:00") },
    ]);
    expect(workerOf(loaded, f.members.cene).timeOff).toEqual([
      { start: loaded.rules.day.start, end: loaded.rules.day.end },
    ]);
    expect(workerOf(loaded, f.members.ana).timeOff).toEqual([]);
  });

  it("men's cut: Ana 07:00–14:30, Bor 12:00–19:30, Cene absent, Olga without a week", async () => {
    const loaded = await loadBusinessDay(db, f.a, "2026-11-17");
    const ana = startsOf(loaded, f.members.ana, MENS_CUT);
    expect([ana[0], ana[ana.length - 1]]).toEqual([at("2026-11-17", "07:00"), at("2026-11-17", "14:30")]);
    const bor = startsOf(loaded, f.members.bor, MENS_CUT);
    expect([bor[0], bor[bor.length - 1]]).toEqual([at("2026-11-17", "12:00"), at("2026-11-17", "19:30")]);
    expect(startsOf(loaded, f.members.cene, MENS_CUT)).toEqual([]);
    expect(startsOf(loaded, f.members.olga, MENS_CUT)).toEqual([]);

    const cene = workerOf(loaded, f.members.cene);
    const problems = explainFit(workerDay(cene), MENS_CUT, at("2026-11-17", "09:00"), rulesOf(loaded));
    expect(problems.map((p) => p.kind)).toContain("time_off");
  });

  it("colouring: Ana fits at 07:00; at 14:00 the last busy step runs past her shift", async () => {
    const loaded = await loadBusinessDay(db, f.a, "2026-11-17");
    const ana = workerDay(workerOf(loaded, f.members.ana));
    const rules = rulesOf(loaded);
    expect(explainFit(ana, COLOURING, at("2026-11-17", "07:00"), rules)).toEqual([]);
    expect(explainFit(ana, COLOURING, at("2026-11-17", "14:00"), rules)).toContainEqual({
      kind: "outside_shift",
      step: 2,
    });
  });
});

describe("loadBusinessDay: a closed holiday", () => {
  it("2026-12-25 has no opening and no free start although Ana's usual Friday applies", async () => {
    const loaded = await loadBusinessDay(db, f.a, "2026-12-25");
    expect(loaded.rules.opening).toEqual([]);
    expect(loaded.holiday?.open).toBe(false);
    expect(workerOf(loaded, f.members.ana).shifts).toEqual([
      { start: at("2026-12-25", "07:00"), end: at("2026-12-25", "15:00") },
    ]);
    for (const w of loaded.workers) expect(startsOf(loaded, w.memberId, MENS_CUT)).toEqual([]);
  });

  it("after the owner opens the day, Ana starts at 07:00 again", async () => {
    await setHolidayOpen(db, f.users.olga, { date: "2026-12-25", open: true }, NOW);
    const loaded = await loadBusinessDay(db, f.a, "2026-12-25");
    expect(loaded.holiday?.open).toBe(true);
    expect(startsOf(loaded, f.members.ana, MENS_CUT)[0]).toBe(at("2026-12-25", "07:00"));
  });
});
