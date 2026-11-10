// @vitest-environment node
// Flowko U29b: the all-or-nothing week save (saveRosterWeek, S3/S5/S6) on a real database (prismock ignores the
// advisory and row locks). Proves Review Focus 2 (two saves with one version → one saved, one roster_changed; the
// second waits on the worker lock and decides on what it re-reads after it; a row reset to the usual week by
// another writer is detected; a refused row leaves the other rows unwritten; needs_confirm → someone else's save
// → confirm: true is roster_changed, never a silent overwrite) and Review Focus 5 (a booking holding the worker
// lock makes the save wait and is counted; 20 rounds of a booking and a save of the same worker's day at once:
// both settle, no deadlock, and the save's warnings count the booking exactly when it committed first). Runs only
// with VITEST_MODE=integration against the throwaway DB.

import { addDays, type ShiftEntry, type WeekHours, type WeekPlan } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, createBusiness } from "./business";
import { FlowkoBusinessError } from "./errors";
import { getRosterWeek, saveRosterWeek, setUsualWeek } from "./roster";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const quiet: WriterDeps = { googleBusy: async () => ({ busy: [], unavailable: false }), sendMails: false };
const S = (from: string, to: string): ShiftEntry => ({ from, to });
const EARLY = [S("07:00", "15:00")];
const LATE = [S("12:00", "20:00")];
const OFFICE = [S("08:00", "16:00")];
const AFTERNOON = [S("13:00", "17:00")];
const USUAL: WeekHours = {
  mon: OFFICE,
  tue: OFFICE,
  wed: OFFICE,
  thu: OFFICE,
  fri: OFFICE,
  sat: [],
  sun: [],
};

type Row = { memberId: number; version: string; days: WeekPlan };
type Fx = {
  olga: number;
  ana: number;
  bor: number;
  zala: number;
  m: { ana: number; bor: number; bea: number };
  mens: number;
};
let fx: Fx;

function week(days: Partial<WeekPlan> = {}): WeekPlan {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null, ...days };
}

async function realUser(name: string): Promise<number> {
  const username = `${name.toLowerCase()}-${RUN}`;
  const user = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name, timeZone: TZ, completedOnboarding: true },
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

/** The save's answer as a string: "saved", "needs_confirm" or the error code. */
async function saveOutcome(promise: ReturnType<typeof saveRosterWeek>): Promise<string> {
  try {
    return (await promise).status;
  } catch (e) {
    if (e instanceof FlowkoBusinessError) return e.code;
    throw e;
  }
}

async function versionOf(memberId: number, weekStart: string): Promise<string> {
  const view = await getRosterWeek(prisma, fx.olga, weekStart, NOW);
  const member = view.members.find((m) => m.memberId === memberId);
  if (!member) throw new Error("fixture: member not in view");
  return member.weekVersion;
}

async function rowFor(memberId: number, weekStart: string, days: WeekPlan): Promise<Row> {
  return { memberId, version: await versionOf(memberId, weekStart), days };
}

const save = (actorUserId: number, weekStart: string, rows: Row[], confirm = false) =>
  saveRosterWeek(prisma, actorUserId, { weekStart, rows, confirm }, NOW);

const dbDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** The member's stored rows of the week as [date, shifts]. */
async function rowsOf(memberId: number, weekStart: string): Promise<Array<[string, unknown]>> {
  const rows = await prisma.flowkoRosterDay.findMany({
    where: { memberId, date: { gte: dbDate(weekStart), lte: dbDate(addDays(weekStart, 6)) } },
    select: { date: true, shifts: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r): [string, unknown] => [r.date.toISOString().slice(0, 10), r.shifts]);
}

function book(memberId: number, start: Date) {
  const input: CreateBookingInput = {
    workerMemberId: memberId,
    serviceIds: [fx.mens],
    start,
    customer: { name: "Marija Novak", phone: "041 123 456", email: `marija-${RUN}@example.com` },
    confirmOverride: false,
  };
  return createBusinessBooking(prisma, fx.olga, input, NOW, quiet);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const olga = await realUser("Olga");
  const { businessId, serviceIds } = await createBusiness(prisma, {
    ownerUserId: olga,
    name: `Salon Urnik ${RUN}`,
    slug: `salon-urnik-${RUN}`,
    templateId: "hair-salon",
  });
  // No work-free day closes a Tuesday of the race weeks (open every day; the save's warnings ignore holidays).
  await prisma.flowkoBusiness.update({
    where: { id: businessId },
    data: { openHolidays: [], holidaysClosed: false },
  });
  const ana = await realUser("Ana");
  const bor = await realUser("Bor");
  const anaMember = await addLoginMember(prisma, businessId, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(prisma, businessId, bor, FlowkoBusinessRole.WORKER);
  const mens = serviceIds[0]; // "Moško striženje", 30 minutes busy
  await prisma.flowkoServiceWorker.createMany({
    data: [anaMember.memberId, borMember.memberId].map((memberId) => ({ serviceId: mens, memberId })),
  });
  await setUsualWeek(prisma, olga, {
    memberId: anaMember.memberId,
    usualWeek: USUAL,
    confirmOutsideOpening: false,
  });

  const zala = await realUser("Zala");
  const other = await createBusiness(prisma, {
    ownerUserId: zala,
    name: `Salon B ${RUN}`,
    slug: `salon-b-${RUN}`,
    templateId: "hair-salon",
  });
  const beaUser = await realUser("Bea");
  const bea = await addLoginMember(prisma, other.businessId, beaUser, FlowkoBusinessRole.WORKER);

  fx = {
    olga,
    ana,
    bor,
    zala,
    m: { ana: anaMember.memberId, bor: borMember.memberId, bea: bea.memberId },
    mens,
  };
});

describe("U29b saveRosterWeek on a real database", () => {
  it("Review Focus 2: two saves with one version at once: exactly one saved, one roster_changed", async () => {
    const WEEK = "2026-11-23";
    const version = await versionOf(fx.m.ana, WEEK);
    const results = await Promise.all([
      saveOutcome(save(fx.olga, WEEK, [{ memberId: fx.m.ana, version, days: week({ mon: EARLY }) }])),
      saveOutcome(save(fx.ana, WEEK, [{ memberId: fx.m.ana, version, days: week({ mon: LATE }) }])),
    ]);
    expect([...results].sort()).toEqual(["roster_changed", "saved"]);
    const winner = results[0] === "saved" ? EARLY : LATE;
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([["2026-11-23", winner]]);
  });

  it("S6: a second save waits on the worker lock and decides on what it re-reads after it (roster_changed)", async () => {
    const WEEK = "2026-11-23";
    const version = await versionOf(fx.m.ana, WEEK);
    const release = deferred();
    const firstHolds = deferred();
    const first = prisma.$transaction(async (tx) => {
      const result = await saveRosterWeek(
        tx,
        fx.olga,
        {
          weekStart: WEEK,
          rows: [{ memberId: fx.m.ana, version, days: week({ tue: EARLY }) }],
          confirm: false,
        },
        NOW
      );
      firstHolds.resolve();
      await release.promise;
      return result;
    });
    // A first save that fails rejects here instead of leaving the hold pending (vitest's timeout is 500 s).
    await Promise.race([firstHolds.promise, first]);
    let secondDone = false;
    // Device 2 read the same version; it saves Ana and Bor (Bor fresh).
    const borRow = await rowFor(fx.m.bor, WEEK, week({ wed: EARLY }));
    const second = saveOutcome(
      save(fx.olga, WEEK, [{ memberId: fx.m.ana, version, days: week({ tue: LATE }) }, borRow])
    ).finally(() => {
      secondDone = true;
    });
    try {
      await sleep(400);
      expect(secondDone).toBe(false); // waits on Ana's advisory lock
    } finally {
      release.resolve();
    }
    expect(await first).toEqual({ status: "saved" });
    expect(await second).toBe("roster_changed");
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([["2026-11-24", EARLY]]);
    expect(await rowsOf(fx.m.bor, WEEK)).toEqual([]); // all or nothing
  });

  it("Review Focus 2: a row reset to the usual week (deleted) by another writer makes the old version stale", async () => {
    const WEEK = "2026-11-30";
    expect(await save(fx.olga, WEEK, [await rowFor(fx.m.ana, WEEK, week({ tue: EARLY }))])).toEqual({
      status: "saved",
    });
    const old = await versionOf(fx.m.ana, WEEK);
    // Another device resets Tuesday to „Običajno“: the row is deleted.
    expect(await save(fx.ana, WEEK, [await rowFor(fx.m.ana, WEEK, week())])).toEqual({ status: "saved" });
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([]);
    const stale = { memberId: fx.m.ana, version: old, days: week({ tue: EARLY }) };
    expect(await codeOf(save(fx.olga, WEEK, [stale]))).toBe("roster_changed");
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([]);
  });

  it("all or nothing: a refused second row leaves the first unwritten", async () => {
    const WEEK = "2026-11-30";
    const ana = await rowFor(fx.m.ana, WEEK, week({ thu: EARLY }));
    const bor = await rowFor(fx.m.bor, WEEK, week({ thu: EARLY }));
    expect(await codeOf(save(fx.ana, WEEK, [ana, bor]))).toBe("forbidden"); // a worker with a colleague's row
    const bea = { memberId: fx.m.bea, version: ana.version, days: week({ thu: EARLY }) };
    expect(await codeOf(save(fx.olga, WEEK, [ana, bea]))).toBe("forbidden"); // another business's member
    expect(await codeOf(save(fx.zala, WEEK, [ana]))).toBe("forbidden");
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([]);
    expect(await rowsOf(fx.m.bor, WEEK)).toEqual([]);
  });

  it("Review Focus 2: needs_confirm → someone else's save → confirm: true is roster_changed", async () => {
    const WEEK = "2026-12-07";
    expect((await book(fx.m.ana, at("2026-12-08", "10:00"))).status).toBe("created");
    const row = await rowFor(fx.m.ana, WEEK, week({ tue: AFTERNOON }));
    expect(await save(fx.olga, WEEK, [row])).toEqual({
      status: "needs_confirm",
      warnings: [{ memberId: fx.m.ana, outsideOpening: [], bookingsNewlyOutside: 1 }],
    });
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([]);
    expect(await save(fx.ana, WEEK, [await rowFor(fx.m.ana, WEEK, week({ wed: EARLY }))])).toEqual({
      status: "saved",
    });
    expect(await codeOf(save(fx.olga, WEEK, [row], true))).toBe("roster_changed");
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([["2026-12-09", EARLY]]);
  });

  it("Review Focus 5: a booking holding the worker lock makes the save wait, then the save counts it", async () => {
    const WEEK = "2026-12-14";
    const row = await rowFor(fx.m.ana, WEEK, week({ tue: AFTERNOON }));
    const release = deferred();
    const bookingHolds = deferred();
    const booking = prisma.$transaction(async (tx) => {
      const result = await createBusinessBooking(
        tx,
        fx.olga,
        {
          workerMemberId: fx.m.ana,
          serviceIds: [fx.mens],
          start: at("2026-12-15", "10:00"),
          customer: { name: "Marija Novak", phone: "041 123 456", email: `marija-${RUN}@example.com` },
          confirmOverride: false,
        },
        NOW,
        quiet
      );
      bookingHolds.resolve();
      await release.promise;
      return result;
    });
    await Promise.race([bookingHolds.promise, booking]);
    let saveDone = false;
    const saving = save(fx.olga, WEEK, [row]).finally(() => {
      saveDone = true;
    });
    try {
      await sleep(400);
      expect(saveDone).toBe(false); // waits on Ana's advisory lock, held by the booking
    } finally {
      release.resolve();
    }
    expect((await booking).status).toBe("created");
    expect(await saving).toEqual({
      status: "needs_confirm",
      warnings: [{ memberId: fx.m.ana, outsideOpening: [], bookingsNewlyOutside: 1 }],
    });
    expect(await rowsOf(fx.m.ana, WEEK)).toEqual([]);
  });

  it("Review Focus 5: 20 rounds of a booking and a save of the same day at once: no deadlock, exact counts", async () => {
    let bookingFirst = 0;
    let saveFirst = 0;
    for (let round = 0; round < 20; round += 1) {
      const WEEK = addDays("2027-01-04", 7 * round);
      const tuesday = addDays(WEEK, 1);
      const row = await rowFor(fx.m.ana, WEEK, week({ tue: AFTERNOON }));
      // The booking writer works before its transaction (services, placement), so a save started at the same
      // moment takes the lock first; the save's start is swept 0…3 ms later (the boundary) so both orders occur.
      const [booked, saved] = await Promise.all([
        book(fx.m.ana, at(tuesday, "10:00")),
        sleep(round % 4).then(() => save(fx.olga, WEEK, [row])),
      ]);

      if (booked.status === "created") {
        // The booking committed first: the save counted it and wrote nothing.
        expect(saved).toEqual({
          status: "needs_confirm",
          warnings: [{ memberId: fx.m.ana, outsideOpening: [], bookingsNewlyOutside: 1 }],
        });
        expect(await rowsOf(fx.m.ana, WEEK)).toEqual([]);
        bookingFirst += 1;
      } else {
        // The save committed first: the booking saw Tuesday 13–17 and asks for the override; nothing booked.
        expect(booked.status).toBe("needs_confirm");
        expect(saved).toEqual({ status: "saved" });
        expect(await rowsOf(fx.m.ana, WEEK)).toEqual([[tuesday, AFTERNOON]]);
        saveFirst += 1;
      }
    }
    expect(bookingFirst + saveFirst).toBe(20);
  }, 60_000);
});
