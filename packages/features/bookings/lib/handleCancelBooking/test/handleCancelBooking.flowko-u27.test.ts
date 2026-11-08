// Flowko U27 (W8): Cal's cancel refuses a business booking (HttpError 400 flowko_business_booking) by uid or id,
// whoever calls it (the organizer, an anonymous caller, reportBooking), and the booking stays ACCEPTED. A business
// booking is cancelled only through the Flowko services (step-aware). An ordinary booking cancels as before.
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import {
  createBookingScenario,
  getDate,
  getGoogleCalendarCredential,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";
import { test } from "@calcom/testing/lib/fixtures/fixtures";
import { describe, expect } from "vitest";

const OLGA = 101; // business owner
const ANA = 102; // worker
const BUSINESS_ID = 2001;
const BUSINESS_UID = "flowko-business-booking";
const ORDINARY_ID = 2002;
const ORDINARY_UID = "olga-ordinary-booking";

function user(id: number, name: string) {
  return getOrganizer({
    name,
    email: `${name.toLowerCase()}@example.com`,
    id,
    schedules: [TestData.schedules.IstWorkHours],
    credentials: [getGoogleCalendarCredential()],
    selectedCalendars: [TestData.selectedCalendars.google],
  });
}

async function setUp(): Promise<void> {
  const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
  await createBookingScenario(
    getScenarioData({
      eventTypes: [{ id: 1, slotInterval: 30, length: 30, userId: OLGA, users: [{ id: OLGA }] }],
      bookings: [
        {
          id: ORDINARY_ID,
          uid: ORDINARY_UID,
          eventTypeId: 1,
          userId: OLGA,
          attendees: [{ email: "booker@example.com", timeZone: "Europe/Ljubljana" }],
          status: BookingStatus.ACCEPTED,
          startTime: `${plus1DateString}T05:00:00.000Z`,
          endTime: `${plus1DateString}T05:30:00.000Z`,
        },
      ],
      organizer: user(OLGA, "Olga"),
      usersApartFromOrganizer: [user(ANA, "Ana")],
      apps: [TestData.apps["google-calendar"]],
    })
  );

  const db = prismaMock as unknown as FlowkoDb;
  const created = await createBusiness(db, {
    ownerUserId: OLGA,
    name: "Salon A",
    slug: "salon-a",
    templateId: "hair-salon",
  });
  // Prismock does not apply @default([]) to scalar lists (test-only).
  await prismaMock.flowkoBusiness.update({ where: { id: created.businessId }, data: { openHolidays: [] } });
  const ana = await addLoginMember(db, created.businessId, ANA, FlowkoBusinessRole.WORKER);
  const mirror = await ensureWorkerMirror(prismaMock as unknown as Prisma.TransactionClient, ana.memberId);
  await prismaMock.booking.create({
    data: {
      id: BUSINESS_ID,
      uid: BUSINESS_UID,
      title: "Salon A",
      startTime: new Date(`${plus1DateString}T07:00:00.000Z`),
      endTime: new Date(`${plus1DateString}T07:30:00.000Z`),
      eventTypeId: mirror.eventTypeId,
      userId: ANA,
      status: BookingStatus.ACCEPTED,
      attendees: {
        create: [{ email: "stranka@example.com", name: "Stranka", timeZone: "Europe/Ljubljana" }],
      },
    },
  });
}

async function statusOf(uid: string) {
  return (await prismaMock.booking.findUnique({ where: { uid }, select: { status: true } }))?.status;
}

describe("handleCancelBooking refuses business bookings (Flowko U27 W8)", () => {
  setupAndTeardown();

  test("refuses a business booking by uid or by id, for its worker, the owner or anyone, and keeps it", async () => {
    const handleCancelBooking = (await import("@calcom/features/bookings/lib/handleCancelBooking")).default;
    await setUp();

    for (const { bookingData, userId } of [
      { bookingData: { uid: BUSINESS_UID, cancellationReason: "x" }, userId: ANA },
      { bookingData: { uid: BUSINESS_UID, cancellationReason: "x" }, userId: OLGA },
      { bookingData: { uid: BUSINESS_UID, cancellationReason: "x" }, userId: -1 },
      { bookingData: { id: BUSINESS_ID, cancellationReason: "x" }, userId: ANA },
    ]) {
      await expect(handleCancelBooking({ bookingData, userId })).rejects.toMatchObject({
        statusCode: 400,
        message: "flowko_business_booking",
      });
    }

    expect(await statusOf(BUSINESS_UID)).toBe(BookingStatus.ACCEPTED);
  });

  test("still cancels an ordinary booking", async () => {
    const handleCancelBooking = (await import("@calcom/features/bookings/lib/handleCancelBooking")).default;
    await setUp();
    await mockCalendarToHaveNoBusySlots("googlecalendar", {});

    const result = await handleCancelBooking({
      bookingData: { uid: ORDINARY_UID, cancelledBy: "olga@example.com", cancellationReason: "x" },
      userId: OLGA,
    });

    expect(result).toMatchObject({ success: true, bookingUid: ORDINARY_UID });
    expect(await statusOf(ORDINARY_UID)).toBe(BookingStatus.CANCELLED);
    expect(await statusOf(BUSINESS_UID)).toBe(BookingStatus.ACCEPTED);
  });
});
