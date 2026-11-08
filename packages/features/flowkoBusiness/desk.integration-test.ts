// @vitest-environment node
// Flowko U28: the desk read service on a real Postgres through the real client (Cal's extensions included). The
// fixture goes through the real U27 writer: Ana's Barvanje 09:00, Bor's cut 13:00 for a phone-only customer, Dan's
// cut 11:00 created BEFORE Dan is locked, plus Olga's own non-mirror Cal booking 12:00–13:00 and business B's
// booking. Shown here and not on prismock: the customer lookup's case-insensitive match is Postgres ILIKE with
// Unicode case folding („MARIJA“, „čuk“ for „Čuk“), the phone filter on real NULLs, RF1 on real responses (real
// uids, real worker addresses, the desk-only placeholder), and no N+1 (the operation count is the same for 2 and
// 6 columns). Google is a stub. Runs only with VITEST_MODE=integration against the throwaway DB.

import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import type { FlowkoDb } from "./db";
import { findCustomers, getDeskDay, getDeskWeek, listDeskMembers, listDeskServices } from "./desk";
import { setMemberLock } from "./lock";
import { setUsualWeek } from "./roster";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const MON = "2026-11-16";
const TUE = "2026-11-17";
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
const ms = (date: string, time: string) => at(date, time).getTime();

const noGoogle: NonNullable<WriterDeps["googleBusy"]> = async () => ({ busy: [], unavailable: false });
const quiet: WriterDeps = { googleBusy: noGoogle, sendMails: false };
const deps = { googleBusy: noGoogle };

const week = (hours: ShiftEntry[]): WeekHours => ({
  mon: hours,
  tue: hours,
  wed: hours,
  thu: hours,
  fri: hours,
  sat: [],
  sun: [],
});

async function realUser(name: string): Promise<number> {
  const username = `${name.toLowerCase()}-${RUN}`;
  const user = await prisma.user.create({
    data: {
      email: `${username}@example.com`,
      username,
      name,
      timeZone: TZ,
      completedOnboarding: true,
      emailVerified: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

async function book(actor: number, input: Omit<CreateBookingInput, "confirmOverride">): Promise<number> {
  const result = await createBusinessBooking(prisma, actor, { ...input, confirmOverride: false }, NOW, quiet);
  if (result.status !== "created") throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  return result.bookingId;
}

type Fx = {
  a: number;
  users: { olga: number; ana: number; bor: number; rok: number; dan: number; zala: number };
  members: { olga: number; ana: number; bor: number; cene: number; dan: number; rok: number };
  services: { mens: number; colouring: number };
  bookings: { ana: number; bor: number; dan: number; olgaOwn: number; b: number };
};
let fx: Fx;

async function servicesOf(businessId: number) {
  const services = await prisma.flowkoService.findMany({
    where: { businessId },
    select: { id: true, name: true },
  });
  const idOf = (name: string) => {
    const s = services.find((x) => x.name === name);
    if (!s) throw new Error(`fixture: service ${name} missing`);
    return s.id;
  };
  return { mens: idOf("Moško striženje"), colouring: idOf("Barvanje") };
}

beforeAll(async () => {
  const olga = await realUser("Olga");
  const created = await createBusiness(prisma, {
    ownerUserId: olga,
    name: `Salon Desk ${RUN}`,
    slug: `salon-desk-${RUN}`,
    templateId: "hair-salon",
    address: "Glavna ulica 1, Ljubljana",
  });
  const a = created.businessId;
  await prisma.flowkoBusiness.update({ where: { id: a }, data: { openHolidays: [] } });
  const ana = await realUser("Ana");
  const bor = await realUser("Bor");
  const rok = await realUser("Rok");
  const dan = await realUser("Dan");
  const anaMember = await addLoginMember(prisma, a, ana, FlowkoBusinessRole.WORKER);
  const borMember = await addLoginMember(prisma, a, bor, FlowkoBusinessRole.WORKER);
  const rokMember = await addLoginMember(prisma, a, rok, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(prisma, a, dan, FlowkoBusinessRole.WORKER);
  const cene = await createDeskOnlyWorker(prisma, a, "Cene");
  const ids = await servicesOf(a);
  const both = [anaMember.memberId, cene.memberId, danMember.memberId];
  await prisma.flowkoServiceWorker.createMany({
    data: [
      ...both.flatMap((memberId) => [
        { serviceId: ids.mens, memberId },
        { serviceId: ids.colouring, memberId },
      ]),
      { serviceId: ids.mens, memberId: borMember.memberId },
    ],
  });
  const usual = (memberId: number, hours: ShiftEntry[]) =>
    setUsualWeek(prisma, olga, { memberId, usualWeek: week(hours), confirmOutsideOpening: false });
  for (const memberId of both) await usual(memberId, [{ from: "07:00", to: "15:00" }]);
  await usual(borMember.memberId, [{ from: "12:00", to: "20:00" }]);

  const anaBooking = await book(olga, {
    workerMemberId: anaMember.memberId,
    serviceIds: [ids.colouring],
    start: at(MON, "09:00"),
    customer: { name: "Marija Novak", phone: "041 123 456", email: "marija@example.com" },
  });
  const borBooking = await book(olga, {
    workerMemberId: borMember.memberId,
    serviceIds: [ids.mens],
    start: at(MON, "13:00"),
    customer: { name: "Petra Kos", phone: "031 555 666" },
  });
  // Dan's booking is created while he is active, then Dan is locked.
  const danBooking = await book(olga, {
    workerMemberId: danMember.memberId,
    serviceIds: [ids.mens],
    start: at(MON, "11:00"),
    customer: { name: "Janez Dolenc", email: "janez@example.com" },
  });
  await setMemberLock(prisma, danMember.memberId, true, NOW);
  // A customer with a capital Č, on Tuesday with desk-only Cene.
  await book(olga, {
    workerMemberId: cene.memberId,
    serviceIds: [ids.mens],
    start: at(TUE, "09:00"),
    customer: { name: "Ivan Čuk", email: "ivan@example.com" },
  });

  const olgaOwn = await prisma.booking.create({
    data: {
      uid: `own-${RUN}`,
      title: "Zasebni sestanek",
      startTime: at(MON, "12:00"),
      endTime: at(MON, "13:00"),
      status: BookingStatus.ACCEPTED,
      user: { connect: { id: olga } },
      attendees: { create: { name: "Zasebna Oseba", email: "private@example.com", timeZone: TZ } },
    },
    select: { id: true },
  });

  const zala = await realUser("Zala");
  const createdB = await createBusiness(prisma, {
    ownerUserId: zala,
    name: `Salon B ${RUN}`,
    slug: `salon-b-${RUN}`,
    templateId: "hair-salon",
  });
  await prisma.flowkoBusiness.update({ where: { id: createdB.businessId }, data: { openHolidays: [] } });
  await setUsualWeek(prisma, zala, {
    memberId: createdB.ownerMemberId,
    usualWeek: week([{ from: "07:00", to: "15:00" }]),
    confirmOutsideOpening: false,
  });
  const idsB = await servicesOf(createdB.businessId);
  const bBooking = await book(zala, {
    workerMemberId: createdB.ownerMemberId,
    serviceIds: [idsB.mens],
    start: at(MON, "10:00"),
    customer: { name: "Mara Bistra", phone: "040 111 222" },
  });

  fx = {
    a,
    users: { olga, ana, bor, rok, dan, zala },
    members: {
      olga: created.ownerMemberId,
      ana: anaMember.memberId,
      bor: borMember.memberId,
      cene: cene.memberId,
      dan: danMember.memberId,
      rok: rokMember.memberId,
    },
    services: ids,
    bookings: { ana: anaBooking, bor: borBooking, dan: danBooking, olgaOwn: olgaOwn.id, b: bBooking },
  };
});

/** RF1 on real data: no uid/userId key, no uid substring, no worker e-mail, no placeholder domain. */
async function expectNoPrivateData(response: unknown): Promise<void> {
  const uids = (await prisma.booking.findMany({ select: { uid: true } })).map((b) => b.uid);
  const members = await prisma.flowkoBusinessMember.findMany({
    where: { userId: { not: null } },
    select: { user: { select: { email: true } } },
  });
  const emails = members.flatMap((m) => (m.user ? [m.user.email.toLowerCase()] : []));
  expect(uids.length).toBeGreaterThan(4);
  expect(emails.some((e) => e.endsWith("@flowko.invalid"))).toBe(true);
  const problems: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (uids.some((uid) => value.includes(uid))) problems.push(`${path}: uid`);
      if (lower.includes("@flowko.invalid")) problems.push(`${path}: placeholder`);
      if (emails.some((e) => lower.includes(e))) problems.push(`${path}: worker e-mail`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (key === "uid" || key === "userId" || key === "iCalUID") problems.push(`${path}.${key}: key`);
        walk(v, `${path}.${key}`);
      }
    }
  };
  walk(response, "$");
  expect(problems).toEqual([]);
}

describe("desk day on Postgres", () => {
  it("columns, rows, flags and other busy as on prismock", async () => {
    const view = await getDeskDay(prisma, fx.users.olga, { date: MON }, NOW, deps);
    const d = view.days[0];
    expect(d.columns.map((c) => [c.memberId, c.locked])).toEqual([
      [fx.members.olga, false],
      [fx.members.ana, false],
      [fx.members.bor, false],
      [fx.members.cene, false],
      [fx.members.dan, true],
    ]);
    expect(d.bookings.map((b) => b.bookingId)).toEqual([fx.bookings.ana, fx.bookings.dan, fx.bookings.bor]);
    const ana = d.bookings[0];
    expect(ana.steps?.map((s) => s.kind)).toEqual(["busy", "processing", "busy"]);
    expect(ana.serviceIds).toEqual([fx.services.colouring]);
    expect(ana.actions.map((a) => [a.kind, a.actorName])).toEqual([["CREATED", "Olga"]]);
    const dan = d.bookings[1];
    expect([dan.mayCancel, dan.mayMove, dan.mayNoShow, dan.mayReenter]).toEqual([true, false, false, true]);
    expect(d.bookings[2].customer).toEqual({ name: "Petra Kos", phone: "+38631555666", email: null });
    expect(d.columns[0].otherBusy).toEqual([{ start: ms(MON, "12:00"), end: ms(MON, "13:00") }]);
    expect(JSON.stringify(view)).not.toContain("Zasebn");
  });

  it("Ana (worker): Bor's row without rights, with the customer's phone", async () => {
    const view = await getDeskDay(prisma, fx.users.ana, { date: MON }, NOW, deps);
    const bor = view.days[0].bookings.find((b) => b.bookingId === fx.bookings.bor);
    expect(bor?.customer.phone).toBe("+38631555666");
    expect([bor?.mayCancel, bor?.mayMove, bor?.mayNoShow, bor?.mayReenter]).toEqual([false, false, false, false]);
  });
});

describe("findCustomers on Postgres (ILIKE, Unicode, NULL phones)", () => {
  const find = (query: string, userId = fx.users.olga) => findCustomers(prisma, userId, { query });

  it("„MARIJA“ (case-insensitive) and „čuk“ for „Čuk“", async () => {
    expect(await find("MARIJA")).toEqual([
      { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
    ]);
    expect(await find("čuk")).toEqual([{ name: "Ivan Čuk", phone: null, email: "ivan@example.com" }]);
    expect(await find("ČUK")).toEqual([{ name: "Ivan Čuk", phone: null, email: "ivan@example.com" }]);
  });

  it("wildcards in the query act as SQL wildcards, but only inside the caller's business", async () => {
    // Flowko U28 (final review): Prisma's `contains` does not escape % and _ on Postgres, so „ma%k“ and „m_rija“
    // find „Marija Novak“. Recorded as found (no production change in U28); the lookup stays scoped to the
    // caller's business: „m_ra“ finds business B's „Mara Bistra“ only for B, and A's „Marija“ never for B.
    const marija = [{ name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" }];
    expect(await find("ma%k")).toEqual(marija);
    expect(await find("m_rija")).toEqual(marija);
    expect(await find("m_ra")).toEqual([]);
    expect(await find("m_ra", fx.users.zala)).toEqual([
      { name: "Mara Bistra", phone: "+38640111222", email: null },
    ]);
    expect(await find("m_rija", fx.users.zala)).toEqual([]);
  });

  it("phone digits skip attendees without a phone; a phone-only e-mail is null", async () => {
    expect(await find("041 12")).toEqual([
      { name: "Marija Novak", phone: "+38641123456", email: "marija@example.com" },
    ]);
    expect(await find("031 555")).toEqual([{ name: "Petra Kos", phone: "+38631555666", email: null }]);
  });

  it("business B's customer never appears for A, and A's never for B", async () => {
    expect(await find("mara")).toEqual([]);
    expect(await find("040 111")).toEqual([]);
    expect(await find("mara", fx.users.zala)).toEqual([
      { name: "Mara Bistra", phone: "+38640111222", email: null },
    ]);
    expect(await find("marija", fx.users.zala)).toEqual([]);
    expect(await find("zasebna")).toEqual([]);
  });
});

describe("RF1 on real responses", () => {
  it("owner, staff and worker: day, week, services, members, customers", async () => {
    for (const userId of [fx.users.olga, fx.users.rok, fx.users.ana]) {
      await expectNoPrivateData(await getDeskDay(prisma, userId, { date: MON }, NOW, deps));
      await expectNoPrivateData(
        await getDeskWeek(prisma, userId, { weekStart: MON, memberId: fx.members.cene }, NOW, deps)
      );
      await expectNoPrivateData(
        await getDeskWeek(prisma, userId, { weekStart: MON, memberId: fx.members.dan }, NOW, deps)
      );
      await expectNoPrivateData(await listDeskServices(prisma, userId));
      await expectNoPrivateData(await listDeskMembers(prisma, userId));
      await expectNoPrivateData(await findCustomers(prisma, userId, { query: "an" }));
      await expectNoPrivateData(await findCustomers(prisma, userId, { query: "0411" }));
    }
  });
});

describe("no N+1: the operation count does not grow with the columns", () => {
  it("2 columns and 6 columns read with the same number of operations", async () => {
    let ops = 0;
    const counted = prisma.$extends({
      query: {
        $allOperations({ args, query }) {
          ops += 1;
          return query(args);
        },
      },
    }) as unknown as FlowkoDb;

    const owner = await realUser(`Nina${RUN.slice(0, 3)}`);
    const c = await createBusiness(prisma, {
      ownerUserId: owner,
      name: `Salon C ${RUN}`,
      slug: `salon-c-${RUN}`,
      templateId: "hair-salon",
    });
    await prisma.flowkoBusiness.update({ where: { id: c.businessId }, data: { openHolidays: [] } });
    const ids = await servicesOf(c.businessId);
    const hours = week([{ from: "07:00", to: "15:00" }]);
    const addWorker = async (name: string, start: string) => {
      const userId = await realUser(name);
      const member = await addLoginMember(prisma, c.businessId, userId, FlowkoBusinessRole.WORKER);
      await prisma.flowkoServiceWorker.create({ data: { serviceId: ids.mens, memberId: member.memberId } });
      await setUsualWeek(prisma, owner, { memberId: member.memberId, usualWeek: hours, confirmOutsideOpening: false });
      await book(owner, {
        workerMemberId: member.memberId,
        serviceIds: [ids.mens],
        start: at(MON, start),
        customer: { name: `Stranka ${name}`, phone: "041 000 111" },
      });
    };
    await setUsualWeek(prisma, owner, { memberId: c.ownerMemberId, usualWeek: hours, confirmOutsideOpening: false });
    await book(owner, {
      workerMemberId: c.ownerMemberId,
      serviceIds: [ids.mens],
      start: at(MON, "09:00"),
      customer: { name: "Stranka Lastnik", phone: "041 000 111" },
    });
    await addWorker("Wa", "09:00");

    ops = 0;
    const two = await getDeskDay(counted, owner, { date: MON }, NOW, deps);
    const opsTwo = ops;
    expect(two.days[0].columns).toHaveLength(2);
    expect(two.days[0].bookings).toHaveLength(2);

    const more = ["Wb", "Wc", "Wd", "We"];
    for (let i = 0; i < more.length; i += 1) await addWorker(more[i], `1${i}:00`);
    ops = 0;
    const six = await getDeskDay(counted, owner, { date: MON }, NOW, deps);
    const opsSix = ops;
    expect(six.days[0].columns).toHaveLength(6);
    expect(six.days[0].bookings).toHaveLength(6);
    expect(opsTwo).toBeGreaterThan(0);
    expect(opsSix).toBe(opsTwo);
  });
});
