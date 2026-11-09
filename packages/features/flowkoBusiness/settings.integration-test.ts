// @vitest-environment node
// Flowko U29a: the owner's settings service on a real database (prismock ignores $executeRaw/$queryRaw, row locks
// and the JSON-path filter of the U22 sweep). Proves Review Focus 2 (a rename and a reminder choice reach every
// mirror; [] switches them off; a mirror the booking writer creates afterwards carries the current choice; the
// sweep's due-candidate query selects nothing for a business with []), Review Focus 7 (a narrower Monday leaves
// Ana's and Bor's usual Monday and a Monday 07:30 booking outside → needs_confirm; confirm saves and changes
// neither), the holiday switch off → on count, settings_changed for a stale form, and S4's row locks: two saves of
// one form at once end in one save and one settings_changed, a first booking's mirror waits for a settings save
// and reads its committed values, and a save waits for a first booking and then updates its new mirror. Runs only with VITEST_MODE=integration against the throwaway DB.

import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
// The U22 sweep's where clause, by relative path: the @lib alias resolves in vitest but not for this package's tsc.
import { dueCandidatesWhere } from "../../../apps/web/lib/flowko/attendeeReminders";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import { FlowkoBusinessError } from "./errors";
import { ensureWorkerMirror } from "./mirror";
import { setUsualWeek } from "./roster";
import { getBusinessSettings, type UpdateBusinessSettingsInput, updateBusinessSettings } from "./settings";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const MON = "2026-11-23";
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const MINUTE_MS = 60_000;
const quiet: WriterDeps = { googleBusy: async () => ({ busy: [], unavailable: false }), sendMails: false };

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

type Fx = {
  businessId: number;
  olga: number;
  members: { ana: number; bor: number; lea: number; mojca: number };
  mens: number;
};
let fx: Fx;

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

/** The settings as the owner's form holds them now, with `over` changed. */
async function formWith(over: Partial<UpdateBusinessSettingsInput>): Promise<UpdateBusinessSettingsInput> {
  const s = await getBusinessSettings(prisma, fx.olga);
  return {
    name: s.name,
    phone: s.phone ?? "",
    address: s.address,
    email: s.email,
    openingHours: s.openingHours,
    slotGridMinutes: s.slotGridMinutes,
    holidaysClosed: s.holidaysClosed,
    reminderOffsets: s.reminderOffsets,
    sharedDevice: s.sharedDevice,
    expectedUpdatedAt: s.updatedAt,
    confirm: false,
    ...over,
  };
}

async function save(over: Partial<UpdateBusinessSettingsInput>) {
  return updateBusinessSettings(prisma, fx.olga, await formWith(over), NOW);
}

async function book(memberId: number, start: Date): Promise<number> {
  const input: CreateBookingInput = {
    workerMemberId: memberId,
    serviceIds: [fx.mens],
    start,
    customer: { name: "Marija Novak", phone: "041 123 456", email: `marija-${RUN}@example.com` },
    confirmOverride: false,
  };
  const result = await createBusinessBooking(prisma, fx.olga, input, NOW, quiet);
  if (result.status !== "created") throw new Error(`expected created, got ${JSON.stringify(result)}`);
  return result.bookingId;
}

async function mirrorOf(memberId: number) {
  const mirror = await prisma.flowkoWorkerMirror.findUnique({
    where: { memberId },
    select: { eventType: { select: { title: true, metadata: true } } },
  });
  return mirror?.eventType ?? null;
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
    name: `Salon Nastavitve ${RUN}`,
    slug: `salon-nast-${RUN}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
    address: "Glavna ulica 1, Ljubljana",
  });
  await prisma.flowkoBusiness.update({ where: { id: businessId }, data: { openHolidays: [] } });
  const ana = await addLoginMember(prisma, businessId, await realUser("Ana"), FlowkoBusinessRole.WORKER);
  const bor = await addLoginMember(prisma, businessId, await realUser("Bor"), FlowkoBusinessRole.WORKER);
  const lea = await addLoginMember(prisma, businessId, await realUser("Lea"), FlowkoBusinessRole.WORKER);
  const mojca = await createDeskOnlyWorker(prisma, businessId, "Mojca");
  const mens = serviceIds[0]; // "Moško striženje", 30 minutes busy
  await prisma.flowkoServiceWorker.createMany({
    data: [ana.memberId, bor.memberId].map((memberId) => ({ serviceId: mens, memberId })),
  });
  for (const memberId of [ana.memberId, bor.memberId]) {
    await setUsualWeek(prisma, olga, {
      memberId,
      usualWeek: week([{ from: "07:00", to: "15:00" }]),
      confirmOutsideOpening: false,
    });
  }
  fx = {
    businessId,
    olga,
    members: { ana: ana.memberId, bor: bor.memberId, lea: lea.memberId, mojca: mojca.memberId },
    mens,
  };
});

describe("U29a settings on a real database", () => {
  it("Review Focus 2: rename and reminders reach the mirrors, a later mirror follows, the sweep honours []", async () => {
    const booking = await book(fx.members.ana, at(MON, "09:00"));
    expect(await mirrorOf(fx.members.ana)).toEqual({
      title: `Salon Nastavitve ${RUN}`,
      metadata: { flowkoMirror: true, flowkoReminders: { enabled: true, offsets: [1440] } },
    });

    expect(await save({ name: `Salon Nova ${RUN}`, reminderOffsets: [120] })).toEqual({ status: "saved" });
    expect(await mirrorOf(fx.members.ana)).toEqual({
      title: `Salon Nova ${RUN}`,
      metadata: { flowkoMirror: true, flowkoReminders: { enabled: true, offsets: [120] } },
    });
    // The sweep's due-candidate query (U22): two hours before, Ana's booking is selected.
    const dueAt = new Date(at(MON, "09:00").getTime() - 120 * MINUTE_MS + MINUTE_MS);
    const selected = () =>
      prisma.booking.findMany({
        where: { AND: [dueCandidatesWhere(dueAt), { id: booking }] },
        select: { id: true },
      });
    expect(await selected()).toEqual([{ id: booking }]);

    expect(await save({ reminderOffsets: [] })).toEqual({ status: "saved" });
    expect((await mirrorOf(fx.members.ana))?.metadata).toEqual({
      flowkoMirror: true,
      flowkoReminders: { enabled: false, offsets: [1440] },
    });
    expect(await selected()).toEqual([]);

    // Bor's first booking creates his mirror with the business's current name and choice.
    await book(fx.members.bor, at(MON, "10:00"));
    expect(await mirrorOf(fx.members.bor)).toEqual({
      title: `Salon Nova ${RUN}`,
      metadata: { flowkoMirror: true, flowkoReminders: { enabled: false, offsets: [1440] } },
    });

    expect(await save({ reminderOffsets: [1440] })).toEqual({ status: "saved" });
  });

  it("settings_changed: a second device's stale form writes nothing", async () => {
    const stale = await formWith({ phone: "01 999 99 99" });
    expect(await save({ address: "Nova ulica 2, Ljubljana" })).toEqual({ status: "saved" });
    expect(await codeOf(updateBusinessSettings(prisma, fx.olga, stale, NOW))).toBe("settings_changed");
    const s = await getBusinessSettings(prisma, fx.olga);
    expect(s.phone).toBe("01 234 56 78");
    expect(s.address).toBe("Nova ulica 2, Ljubljana");
  });

  it("Review Focus 7: Mon 07–20 → 08–20 with usual Mondays 07–15 and a Monday 07:30 booking", async () => {
    const early = await book(fx.members.ana, at(MON, "07:30"));
    const before = await getBusinessSettings(prisma, fx.olga);
    const narrower = { ...before.openingHours, mon: [{ from: "08:00", to: "20:00" }] };

    expect(await save({ openingHours: narrower })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 2, bookings: 1 },
    });
    expect(await getBusinessSettings(prisma, fx.olga)).toEqual(before);

    expect(await save({ openingHours: narrower, confirm: true })).toEqual({ status: "saved" });
    expect((await getBusinessSettings(prisma, fx.olga)).openingHours.mon).toEqual([
      { from: "08:00", to: "20:00" },
    ]);
    const ana = await prisma.flowkoBusinessMember.findUniqueOrThrow({
      where: { id: fx.members.ana },
      select: { usualWeek: true },
    });
    expect(ana.usualWeek).toEqual(week([{ from: "07:00", to: "15:00" }]));
    const stored = await prisma.booking.findUniqueOrThrow({
      where: { id: early },
      select: { startTime: true, endTime: true, status: true },
    });
    expect(stored).toEqual({
      startTime: at(MON, "07:30"),
      endTime: at(MON, "08:00"),
      status: BookingStatus.ACCEPTED,
    });
  });

  it("holiday switch off → on counts the bookings on closed work-free days", async () => {
    expect(await save({ holidaysClosed: false })).toEqual({ status: "saved" });
    await book(fx.members.ana, at("2026-12-25", "09:00")); // Fri, božič
    expect(await save({ holidaysClosed: true })).toEqual({
      status: "needs_confirm",
      outside: { shifts: 0, bookings: 1 },
    });
    expect(await save({ holidaysClosed: true, confirm: true })).toEqual({ status: "saved" });
    expect((await getBusinessSettings(prisma, fx.olga)).holidaysClosed).toBe(true);
  });

  it("S4: two saves from one form at once: the second waits on the row lock and gets settings_changed", async () => {
    const formA = await formWith({ phone: "01 111 11 11" });
    const formB = { ...formA, phone: "01 222 22 22" };
    const release = deferred();
    const aHolds = deferred();
    const savingA = prisma.$transaction(async (tx) => {
      const result = await updateBusinessSettings(tx, fx.olga, formA, NOW);
      aHolds.resolve();
      await release.promise;
      return result;
    });
    await aHolds.promise;
    let bDone = false;
    const savingB = codeOf(updateBusinessSettings(prisma, fx.olga, formB, NOW)).finally(() => {
      bDone = true;
    });
    try {
      await sleep(400);
      expect(bDone).toBe(false); // FOR UPDATE waits behind A's lock
    } finally {
      release.resolve();
    }
    expect(await savingA).toEqual({ status: "saved" });
    expect(await savingB).toBe("settings_changed");
    expect((await getBusinessSettings(prisma, fx.olga)).phone).toBe("01 111 11 11");
  });

  it("S4: a first booking's mirror waits for a settings save and reads its committed values", async () => {
    const form = await formWith({ name: `Salon Zaklep ${RUN}`, reminderOffsets: [1440, 120] });
    const release = deferred();
    const saveHolds = deferred();
    const saving = prisma.$transaction(async (tx) => {
      const result = await updateBusinessSettings(tx, fx.olga, form, NOW);
      saveHolds.resolve();
      await release.promise;
      return result;
    });
    await saveHolds.promise;

    let mirrorDone = false;
    const mirroring = prisma
      .$transaction((tx) => ensureWorkerMirror(tx, fx.members.lea))
      .finally(() => {
        mirrorDone = true;
      });
    try {
      await sleep(400);
      expect(mirrorDone).toBe(false); // waits on FOR SHARE behind the save's FOR UPDATE
    } finally {
      release.resolve();
    }
    expect(await saving).toEqual({ status: "saved" });
    await mirroring;
    expect(await mirrorOf(fx.members.lea)).toEqual({
      title: `Salon Zaklep ${RUN}`,
      metadata: { flowkoMirror: true, flowkoReminders: { enabled: true, offsets: [1440, 120] } },
    });
  });

  it("S4: a settings save waits for a first booking's mirror and then updates it too", async () => {
    const release = deferred();
    const mirrorHolds = deferred();
    const mirroring = prisma.$transaction(async (tx) => {
      await ensureWorkerMirror(tx, fx.members.mojca);
      mirrorHolds.resolve();
      await release.promise;
    });
    await mirrorHolds.promise;

    const form = await formWith({ name: `Salon Konec ${RUN}`, reminderOffsets: [120] });
    let saveDone = false;
    const saving = updateBusinessSettings(prisma, fx.olga, form, NOW).finally(() => {
      saveDone = true;
    });
    try {
      await sleep(400);
      expect(saveDone).toBe(false); // the save waits behind the mirror's FOR SHARE
    } finally {
      release.resolve();
    }
    await mirroring;
    expect(await saving).toEqual({ status: "saved" });
    for (const memberId of [fx.members.ana, fx.members.bor, fx.members.lea, fx.members.mojca]) {
      expect(await mirrorOf(memberId)).toEqual({
        title: `Salon Konec ${RUN}`,
        metadata: { flowkoMirror: true, flowkoReminders: { enabled: true, offsets: [120] } },
      });
    }
  });
});
