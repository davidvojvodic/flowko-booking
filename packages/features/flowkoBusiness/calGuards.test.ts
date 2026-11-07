// Flowko U27: the guards Cal's booking paths call (G1, G2), on prismock through the global client. Business A
// (owner Olga, worker Ana, staff Rok, locked worker Dan); Ana's mirror carries one business booking, Olga's own
// event type an ordinary one.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import { HttpError } from "@calcom/lib/http-error";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import type { Prisma } from "@calcom/prisma/client";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it } from "vitest";
import { addLoginMember, createBusiness } from "./business";
import {
  assertNotBusinessBooking,
  assertNotBusinessBookingTrpc,
  assertNotMirrorEventType,
  assertNotNonOwnerMemberEventType,
  FLOWKO_BUSINESS_BOOKING,
} from "./calGuards";
import type { FlowkoDb } from "./db";
import { ensureWorkerMirror } from "./mirror";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
let seq = 0;

async function makeUser(name: string): Promise<number> {
  seq += 1;
  const user = await prismock.user.create({
    data: { email: `${name.toLowerCase()}${seq}@example.com`, username: `${name.toLowerCase()}${seq}`, name },
    select: { id: true },
  });
  return user.id;
}

async function bookingOn(eventTypeId: number, userId: number): Promise<{ id: number; uid: string }> {
  seq += 1;
  return prismock.booking.create({
    data: {
      uid: `u27-guard-booking-${seq}`,
      title: "Booking",
      startTime: new Date("2026-11-16T09:00:00Z"),
      endTime: new Date("2026-11-16T09:30:00Z"),
      eventTypeId,
      userId,
    },
    select: { id: true, uid: true },
  });
}

type Fixture = {
  users: { olga: number; ana: number; rok: number; dan: number; stranger: number };
  mirrorEventTypeId: number;
  ownEventTypeId: number;
  business: { id: number; uid: string };
  ordinary: { id: number; uid: string };
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga,
    name: "Salon A",
    slug: `salon-a-${seq}`,
    templateId: "hair-salon",
  });
  // Prismock does not apply @default([]) to scalar lists (test-only).
  await prismock.flowkoBusiness.update({ where: { id: created.businessId }, data: { openHolidays: [] } });
  const ana = await makeUser("Ana");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const stranger = await makeUser("Stranger");
  const anaMember = await addLoginMember(db, created.businessId, ana, FlowkoBusinessRole.WORKER);
  await addLoginMember(db, created.businessId, rok, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, created.businessId, dan, FlowkoBusinessRole.WORKER);
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });

  const mirror = await ensureWorkerMirror(tx, anaMember.memberId);
  const own = await prismock.eventType.create({
    data: { title: "Posvet", slug: `posvet-${seq}`, length: 30, userId: olga },
    select: { id: true },
  });
  return {
    users: { olga, ana, rok, dan, stranger },
    mirrorEventTypeId: mirror.eventTypeId,
    ownEventTypeId: own.id,
    business: await bookingOn(mirror.eventTypeId, ana),
    ordinary: await bookingOn(own.id, olga),
  };
}

/** "ok", "http:<status>:<message>" or "trpc:<code>:<message>"; any other error fails the test. */
async function outcome(promise: Promise<void>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (e) {
    if (e instanceof HttpError) return `http:${e.statusCode}:${e.message}`;
    if (e instanceof TRPCError) return `trpc:${e.code}:${e.message}`;
    throw e;
  }
}

let f: Fixture;

beforeEach(async () => {
  f = await setUp();
});

describe("calGuards", () => {
  it("names the refusal flowko_business_booking", () => {
    expect(FLOWKO_BUSINESS_BOOKING).toBe("flowko_business_booking");
  });

  it("assertNotMirrorEventType refuses a mirror with HttpError 400, lets any other event type through", async () => {
    expect(await outcome(assertNotMirrorEventType(f.mirrorEventTypeId))).toBe(
      "http:400:flowko_business_booking"
    );
    expect(await outcome(assertNotMirrorEventType(f.ownEventTypeId))).toBe("ok");
    expect(await outcome(assertNotMirrorEventType(987654))).toBe("ok");
    expect(await outcome(assertNotMirrorEventType(null))).toBe("ok");
    expect(await outcome(assertNotMirrorEventType(undefined))).toBe("ok");
  });

  it("assertNotNonOwnerMemberEventType refuses a worker's or staff member's event type (locked too), not the owner's", async () => {
    const refused = "http:400:flowko_business_booking";
    expect(await outcome(assertNotNonOwnerMemberEventType(f.users.ana))).toBe(refused);
    expect(await outcome(assertNotNonOwnerMemberEventType(f.users.rok))).toBe(refused);
    expect(await outcome(assertNotNonOwnerMemberEventType(f.users.dan))).toBe(refused);
    expect(await outcome(assertNotNonOwnerMemberEventType(f.users.olga))).toBe("ok");
    expect(await outcome(assertNotNonOwnerMemberEventType(f.users.stranger))).toBe("ok");
    expect(await outcome(assertNotNonOwnerMemberEventType(null))).toBe("ok");
    expect(await outcome(assertNotNonOwnerMemberEventType(undefined))).toBe("ok");
  });

  it("assertNotBusinessBooking refuses a business booking by id or uid with HttpError 400", async () => {
    const refused = "http:400:flowko_business_booking";
    expect(await outcome(assertNotBusinessBooking({ id: f.business.id }))).toBe(refused);
    expect(await outcome(assertNotBusinessBooking({ uid: f.business.uid }))).toBe(refused);
    expect(await outcome(assertNotBusinessBooking({ id: f.ordinary.id, uid: f.business.uid }))).toBe(refused);
    expect(await outcome(assertNotBusinessBooking({ id: f.ordinary.id }))).toBe("ok");
    expect(await outcome(assertNotBusinessBooking({ uid: f.ordinary.uid }))).toBe("ok");
    expect(await outcome(assertNotBusinessBooking({ uid: "no-such-uid" }))).toBe("ok");
    expect(await outcome(assertNotBusinessBooking({ id: 987654 }))).toBe("ok");
    expect(await outcome(assertNotBusinessBooking({}))).toBe("ok");
  });

  it("assertNotBusinessBookingTrpc refuses a business booking with TRPCError FORBIDDEN", async () => {
    const refused = "trpc:FORBIDDEN:flowko_business_booking";
    expect(await outcome(assertNotBusinessBookingTrpc({ id: f.business.id }))).toBe(refused);
    expect(await outcome(assertNotBusinessBookingTrpc({ uid: f.business.uid }))).toBe(refused);
    expect(await outcome(assertNotBusinessBookingTrpc({ id: f.ordinary.id }))).toBe("ok");
    expect(await outcome(assertNotBusinessBookingTrpc({ uid: f.ordinary.uid }))).toBe("ok");
    expect(await outcome(assertNotBusinessBookingTrpc({}))).toBe("ok");
  });
});
