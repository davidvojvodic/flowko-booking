// @vitest-environment node
// Flowko U29c: the owner's „Delavci“ list (listWorkers, W1) on a real database with real business bookings
// written by the U27 writer. Proves Review Focus 1 (privacy): Dan (LOCKED) has three real bookings, one of them
// cancelled afterwards, plus a private Cal booking of his own on his own event type and a Cal booking from before
// he joined (no mirror) -> only the two live mirror bookings count and are listed, with local date and time,
// distinct services in step order and the first attendee; Ana (ACTIVE) shows a count and no list; another
// business's booking never shows; a non-owner is forbidden; the answer holds no uid, e-mail, phone or user id.
// Runs only with VITEST_MODE=integration against the throwaway DB.

import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";
import { type CreateBookingInput, createBusinessBooking, type WriterDeps } from "./bookingWriter";
import { addLoginMember, createBusiness, createDeskOnlyWorker } from "./business";
import { FlowkoBusinessError } from "./errors";
import { setMemberLock } from "./lock";
import { setUsualWeek } from "./roster";
import { listWorkers } from "./workers";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-11-16T07:07:00Z"); // Mon 08:07 in Ljubljana
const TUE = "2026-11-17";
const at = (date: string, time: string) => new Date(wallClockToMs(date, time, TZ));
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
  olga: number;
  zala: number;
  ana: number;
  members: { olga: number; ana: number; dan: number; mojca: number; bea: number };
  mens: number;
  feniranje: number;
  ids: { danKept: number; danTwoServices: number; danCancelled: number; ana: number; bea: number };
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

async function book(
  actor: number,
  memberId: number,
  serviceIds: number[],
  start: Date,
  customerName: string
): Promise<number> {
  const input: CreateBookingInput = {
    workerMemberId: memberId,
    serviceIds,
    start,
    customer: {
      name: customerName,
      phone: "041 123 456",
      email: `${customerName.replace(/\s/g, ".")}-${RUN}@example.com`,
    },
    confirmOverride: false,
  };
  const result = await createBusinessBooking(prisma, actor, input, NOW, quiet);
  if (result.status !== "created")
    throw new Error(`fixture: expected created, got ${JSON.stringify(result)}`);
  return result.bookingId;
}

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

beforeAll(async () => {
  const olga = await realUser("Olga");
  const { businessId, ownerMemberId, serviceIds } = await createBusiness(prisma, {
    ownerUserId: olga,
    name: `Salon Delavci ${RUN}`,
    slug: `salon-delavci-${RUN}`,
    templateId: "hair-salon",
    phone: "01 234 56 78",
  });
  await prisma.flowkoBusiness.update({ where: { id: businessId }, data: { openHolidays: [] } });
  const anaUser = await realUser("Ana");
  const danUser = await realUser("Dan");
  const ana = await addLoginMember(prisma, businessId, anaUser, FlowkoBusinessRole.WORKER);
  const dan = await addLoginMember(prisma, businessId, danUser, FlowkoBusinessRole.WORKER);
  const mojca = await createDeskOnlyWorker(prisma, businessId, "Mojca");
  const mens = serviceIds[0]; // "Moško striženje"
  const feniranje = serviceIds[5];
  await prisma.flowkoServiceWorker.createMany({
    data: [ana.memberId, dan.memberId].flatMap((memberId) => [
      { serviceId: mens, memberId },
      { serviceId: feniranje, memberId },
    ]),
  });
  for (const memberId of [ana.memberId, dan.memberId]) {
    await setUsualWeek(prisma, olga, {
      memberId,
      usualWeek: week([{ from: "08:00", to: "16:00" }]),
      confirmOutsideOpening: false,
    });
  }

  // Dan's real business bookings (the owner books for him), then one of them is cancelled.
  const danKept = await book(olga, dan.memberId, [mens], at(TUE, "09:00"), "Marija Novak");
  const danTwoServices = await book(olga, dan.memberId, [mens, feniranje], at(TUE, "10:00"), "Eva Zupan");
  const danCancelled = await book(olga, dan.memberId, [mens], at(TUE, "13:00"), "Ivan Horvat");
  await prisma.booking.update({ where: { id: danCancelled }, data: { status: BookingStatus.CANCELLED } });
  const anaBooking = await book(olga, ana.memberId, [mens], at(TUE, "09:00"), "Nina Kos");

  // Dan's own Cal bookings: one on his private event type, one from before he joined (no mirror). Neither may show.
  const ownType = await prisma.eventType.create({
    data: { title: "Private", slug: `private-dan-${RUN}`, length: 30, userId: danUser },
    select: { id: true },
  });
  for (const [eventTypeId, uid, createdAt, time] of [
    [ownType.id, `u29c-private-${RUN}`, new Date(), "10:00"],
    [null, `u29c-prejoin-${RUN}`, new Date("2020-01-01T00:00:00Z"), "12:00"],
  ] as const) {
    await prisma.booking.create({
      data: {
        uid,
        title: "Private",
        startTime: at("2026-11-18", time),
        endTime: new Date(at("2026-11-18", time).getTime() + 3_600_000),
        userId: danUser,
        eventTypeId,
        status: BookingStatus.ACCEPTED,
        createdAt,
        attendees: { create: { name: "Secret Person", email: `secret-${RUN}@example.com`, timeZone: TZ } },
      },
    });
  }
  await setMemberLock(prisma, dan.memberId, true, NOW);

  // Another business with a booking of its own.
  const zala = await realUser("Zala");
  const other = await createBusiness(prisma, {
    ownerUserId: zala,
    name: `Salon B ${RUN}`,
    slug: `salon-b-${RUN}`,
    templateId: "hair-salon",
  });
  await prisma.flowkoBusiness.update({ where: { id: other.businessId }, data: { openHolidays: [] } });
  const bea = await addLoginMember(
    prisma,
    other.businessId,
    await realUser("Bea"),
    FlowkoBusinessRole.WORKER
  );
  await prisma.flowkoServiceWorker.create({
    data: { serviceId: other.serviceIds[0], memberId: bea.memberId },
  });
  await setUsualWeek(prisma, zala, {
    memberId: bea.memberId,
    usualWeek: week([{ from: "08:00", to: "16:00" }]),
    confirmOutsideOpening: false,
  });
  const beaBooking = await book(zala, bea.memberId, [other.serviceIds[0]], at(TUE, "09:00"), "Bea Kunde");

  fx = {
    olga,
    zala,
    ana: anaUser,
    members: {
      olga: ownerMemberId,
      ana: ana.memberId,
      dan: dan.memberId,
      mojca: mojca.memberId,
      bea: bea.memberId,
    },
    mens,
    feniranje,
    ids: { danKept, danTwoServices, danCancelled, ana: anaBooking, bea: beaBooking },
  };
});

describe("U29c listWorkers on a real database", () => {
  it("Review Focus 1: Dan's two live mirror bookings are counted and listed; private, pre-join, cancelled and foreign ones are not", async () => {
    const { members } = await listWorkers(prisma, fx.olga, NOW);
    expect(members.map((m) => [m.displayName, m.role, m.status, m.futureCount])).toEqual([
      ["Olga", "OWNER", "ACTIVE", 0],
      ["Ana", "WORKER", "ACTIVE", 1],
      ["Dan", "WORKER", "LOCKED", 2],
      ["Mojca", "WORKER", "ACTIVE", 0],
    ]);
    const dan = members.find((m) => m.memberId === fx.members.dan);
    expect(dan?.futureBookings).toEqual([
      {
        bookingId: fx.ids.danKept,
        date: TUE,
        from: "09:00",
        to: "09:30",
        services: ["Moško striženje"],
        customerName: "Marija Novak",
      },
      {
        bookingId: fx.ids.danTwoServices,
        date: TUE,
        from: "10:00",
        to: "11:00",
        services: ["Moško striženje", "Feniranje"],
        customerName: "Eva Zupan",
      },
    ]);
    expect(dan?.moreBookings).toBe(0);
    expect(members.find((m) => m.memberId === fx.members.ana)?.futureBookings).toEqual([]);
    expect(members.find((m) => m.memberId === fx.members.mojca)).toMatchObject({
      noLogin: true,
      isMe: false,
    });
    expect(members.find((m) => m.memberId === fx.members.olga)).toMatchObject({ isMe: true, noLogin: false });
  });

  it("Review Focus 1: no uid, e-mail, phone or user id in the answer; the private booking's person never appears", async () => {
    const answer = await listWorkers(prisma, fx.olga, NOW);
    const keys = keysDeep(answer);
    for (const banned of ["uid", "email", "phone", "phoneNumber", "userId", "user", "username"]) {
      expect(keys.has(banned)).toBe(false);
    }
    const json = JSON.stringify(answer);
    expect(json).not.toContain("@");
    expect(json).not.toContain("041 123 456");
    expect(json).not.toContain("Secret Person");
    expect(json).not.toContain(RUN);
  });

  it("another business sees its own members and bookings only", async () => {
    const { members } = await listWorkers(prisma, fx.zala, NOW);
    expect(members.map((m) => [m.displayName, m.futureCount])).toEqual([
      ["Zala", 0],
      ["Bea", 1],
    ]);
  });

  it("a worker (and a locked worker) is forbidden", async () => {
    expect(await codeOf(listWorkers(prisma, fx.ana, NOW))).toBe("forbidden");
    expect(await codeOf(listWorkers(prisma, fx.olga + 999_999, NOW))).toBe("forbidden");
  });
});
