// Flowko U27 (G1): Cal's booking service never writes a business booking. It refuses a worker mirror, an event type
// owned by a worker or staff member of a business, and a reschedule of a business booking, each with HttpError 400
// flowko_business_booking and before any write. The owner's own event types still book and reschedule as before.
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import {
  createBookingScenario,
  getBooker,
  getDate,
  getGoogleCalendarCredential,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";
import { test } from "@calcom/testing/lib/fixtures/fixtures";
import { describe, expect } from "vitest";

import { getNewBookingHandler } from "../handleNewBooking/test/getNewBookingHandler";

const refusal = { statusCode: 400, message: "flowko_business_booking" };

const OLGA = 101; // business owner
const ANA = 102; // worker

const booker = getBooker({ email: "booker@example.com", name: "Booker" });
const bookerResponses = {
  email: booker.email,
  name: booker.name,
  location: { optionValue: "" as const, value: "inPerson" },
};

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

const BUSINESS_UID = "flowko-business-booking";
const ORDINARY_UID = "olga-ordinary-booking";

/**
 * Olga's event type 1 and Ana's own event type 2 (both ordinary Cal event types), Olga's ordinary booking, then
 * business A (owner Olga, worker Ana) with Ana's mirror and one business booking on it.
 */
async function setUp(): Promise<{ mirrorEventTypeId: number; plus2DateString: string }> {
  const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
  const { dateString: plus2DateString } = getDate({ dateIncrement: 2 });
  await createBookingScenario(
    getScenarioData({
      eventTypes: [
        {
          id: 1,
          slotInterval: 30,
          length: 30,
          userId: OLGA,
          locations: [{ type: "inPerson", address: "Ljubljana" }],
          users: [{ id: OLGA }],
        },
        {
          id: 2,
          slotInterval: 30,
          length: 30,
          userId: ANA,
          locations: [{ type: "inPerson", address: "Ljubljana" }],
          users: [{ id: ANA }],
        },
      ],
      bookings: [
        {
          uid: ORDINARY_UID,
          eventTypeId: 1,
          userId: OLGA,
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
      uid: BUSINESS_UID,
      title: "Salon A",
      startTime: new Date(`${plus1DateString}T07:00:00.000Z`),
      endTime: new Date(`${plus1DateString}T07:30:00.000Z`),
      eventTypeId: mirror.eventTypeId,
      userId: ANA,
      status: BookingStatus.ACCEPTED,
    },
  });
  return { mirrorEventTypeId: mirror.eventTypeId, plus2DateString };
}

async function bookingCount(): Promise<number> {
  return prismaMock.booking.count();
}

async function statusOf(uid: string) {
  return (await prismaMock.booking.findUnique({ where: { uid }, select: { status: true } }))?.status;
}

describe("RegularBookingService refuses business bookings (Flowko U27 G1)", () => {
  setupAndTeardown();

  test("refuses a booking of a worker mirror, writes nothing", async () => {
    const handleNewBooking = getNewBookingHandler();
    const { mirrorEventTypeId } = await setUp();
    const before = await bookingCount();

    await expect(
      handleNewBooking({
        bookingData: getMockRequestDataForBooking({
          data: { eventTypeId: mirrorEventTypeId, responses: bookerResponses },
        }),
      })
    ).rejects.toMatchObject(refusal);

    expect(await bookingCount()).toBe(before);
  });

  test("refuses a booking of a worker's own ordinary event type, signed in or not", async () => {
    const handleNewBooking = getNewBookingHandler();
    await setUp();
    const before = await bookingCount();

    for (const userId of [undefined, OLGA, ANA]) {
      await expect(
        handleNewBooking({
          bookingData: getMockRequestDataForBooking({ data: { eventTypeId: 2, responses: bookerResponses } }),
          userId,
        })
      ).rejects.toMatchObject(refusal);
    }

    expect(await bookingCount()).toBe(before);
  });

  test("refuses to reschedule a business booking through the owner's own event type, the booking stays", async () => {
    const handleNewBooking = getNewBookingHandler();
    const { plus2DateString } = await setUp();
    const before = await bookingCount();

    await expect(
      handleNewBooking({
        bookingData: getMockRequestDataForBooking({
          data: {
            eventTypeId: 1,
            rescheduleUid: BUSINESS_UID,
            start: `${plus2DateString}T04:00:00.000Z`,
            end: `${plus2DateString}T04:30:00.000Z`,
            responses: bookerResponses,
          },
        }),
        userId: OLGA,
      })
    ).rejects.toMatchObject(refusal);

    expect(await statusOf(BUSINESS_UID)).toBe(BookingStatus.ACCEPTED);
    expect(await bookingCount()).toBe(before);
  });

  test("still books the owner's own event type", async () => {
    const handleNewBooking = getNewBookingHandler();
    await setUp();
    await mockCalendarToHaveNoBusySlots("googlecalendar", {});

    const createdBooking = await handleNewBooking({
      bookingData: getMockRequestDataForBooking({ data: { eventTypeId: 1, responses: bookerResponses } }),
    });

    expect(createdBooking).toEqual(
      expect.objectContaining({ uid: expect.any(String), status: BookingStatus.ACCEPTED })
    );
  });

  test("still reschedules an ordinary booking", async () => {
    const handleNewBooking = getNewBookingHandler();
    const { plus2DateString } = await setUp();
    await mockCalendarToHaveNoBusySlots("googlecalendar", {});

    const createdBooking = await handleNewBooking({
      bookingData: getMockRequestDataForBooking({
        data: {
          eventTypeId: 1,
          rescheduleUid: ORDINARY_UID,
          start: `${plus2DateString}T04:00:00.000Z`,
          end: `${plus2DateString}T04:30:00.000Z`,
          responses: bookerResponses,
        },
      }),
      userId: OLGA,
    });

    expect(createdBooking).toEqual(
      expect.objectContaining({ uid: expect.any(String), status: BookingStatus.ACCEPTED })
    );
    expect(createdBooking.uid).not.toBe(ORDINARY_UID);
    expect(await statusOf(ORDINARY_UID)).toBe(BookingStatus.CANCELLED);
    expect(await statusOf(BUSINESS_UID)).toBe(BookingStatus.ACCEPTED);
  });
});
