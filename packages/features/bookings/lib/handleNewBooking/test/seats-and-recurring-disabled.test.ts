/**
 * Seated and recurring event types are off on this instance (IS_SEATS_AND_RECURRING_ENABLED). The event
 * type handlers refuse to turn either on, so the seated and recurring event types below stand for ones made
 * that way before the switch or outside the web app. The booking services must still refuse to book them.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  createBookingScenario,
  getBooker,
  getDate,
  getGoogleCalendarCredential,
  getMockBookingAttendee,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import { v4 as uuidv4 } from "uuid";
import { describe, expect } from "vitest";

import { getRecurringBookingService } from "@calcom/features/bookings/di/RecurringBookingService.container";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { BookingStatus } from "@calcom/prisma/enums";
import { test } from "@calcom/testing/lib/fixtures/fixtures";

import { getNewBookingHandler } from "./getNewBookingHandler";

const refusal = { statusCode: 400, message: ErrorCode.SeatsAndRecurringNotAvailable };

const booker = getBooker({
  email: "booker@example.com",
  name: "Booker",
});

const bookerResponses = {
  email: booker.email,
  name: booker.name,
  location: { optionValue: "" as const, value: "New York" },
};

function getTestOrganizer() {
  return getOrganizer({
    name: "Organizer",
    email: "organizer@example.com",
    id: 101,
    schedules: [TestData.schedules.IstWorkHours],
    credentials: [getGoogleCalendarCredential()],
    selectedCalendars: [TestData.selectedCalendars.google],
  });
}

describe("handleNewBooking with seats and recurring events off", () => {
  setupAndTeardown();

  test("refuses a booking of a seated event type", async () => {
    const handleNewBooking = getNewBookingHandler();

    await createBookingScenario(
      getScenarioData({
        eventTypes: [{ id: 1, slotInterval: 30, length: 30, seatsPerTimeSlot: 3, users: [{ id: 101 }] }],
        organizer: getTestOrganizer(),
        apps: [TestData.apps["google-calendar"]],
      })
    );

    await expect(
      handleNewBooking({
        bookingData: getMockRequestDataForBooking({ data: { eventTypeId: 1, responses: bookerResponses } }),
      })
    ).rejects.toMatchObject(refusal);

    expect(await prismaMock.booking.findMany()).toHaveLength(0);
  });

  test("refuses a single booking of a recurring event type", async () => {
    const handleNewBooking = getNewBookingHandler();

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slotInterval: 30,
            length: 30,
            recurringEvent: { freq: 2, count: 3, interval: 1 },
            users: [{ id: 101 }],
          },
        ],
        organizer: getTestOrganizer(),
        apps: [TestData.apps["google-calendar"]],
      })
    );

    await expect(
      handleNewBooking({
        bookingData: getMockRequestDataForBooking({ data: { eventTypeId: 1, responses: bookerResponses } }),
      })
    ).rejects.toMatchObject(refusal);

    expect(await prismaMock.booking.findMany()).toHaveLength(0);
  });

  test("refuses a request that names a recurring series or a seat", async () => {
    const handleNewBooking = getNewBookingHandler();

    await createBookingScenario(
      getScenarioData({
        eventTypes: [{ id: 1, slotInterval: 30, length: 30, users: [{ id: 101 }] }],
        organizer: getTestOrganizer(),
        apps: [TestData.apps["google-calendar"]],
      })
    );

    const bookingData = getMockRequestDataForBooking({
      data: { eventTypeId: 1, responses: bookerResponses },
    });

    for (const requestNamingSeriesOrSeat of [
      { ...bookingData, recurringEventId: uuidv4(), recurringCount: 3 },
      {
        ...bookingData,
        allRecurringDates: [{ start: bookingData.start, end: bookingData.end }],
        isFirstRecurringSlot: true,
      },
      { ...bookingData, seatReferenceUid: "booking-seat-1" },
    ]) {
      const booking = handleNewBooking({ bookingData: requestNamingSeriesOrSeat });
      await expect(booking).rejects.toMatchObject(refusal);
    }

    expect(await prismaMock.booking.findMany()).toHaveLength(0);
  });

  test("refuses to move a booking that still has seats, by its uid or by a seat's reference", async () => {
    const handleNewBooking = getNewBookingHandler();

    const organizer = getTestOrganizer();
    const bookingId = 1;
    const bookingUid = "abc123";
    const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
    const { dateString: plus2DateString } = getDate({ dateIncrement: 2 });

    await createBookingScenario(
      getScenarioData({
        // The event type isn't seated (any more), but its booking still has two seats
        eventTypes: [{ id: 1, slotInterval: 30, length: 30, seatsPerTimeSlot: null, users: [{ id: 101 }] }],
        bookings: [
          {
            id: bookingId,
            uid: bookingUid,
            eventTypeId: 1,
            userId: organizer.id,
            status: BookingStatus.ACCEPTED,
            startTime: `${plus1DateString}T04:00:00Z`,
            endTime: `${plus1DateString}T04:30:00Z`,
            attendees: [
              getMockBookingAttendee({
                id: 1,
                name: "Seat 1",
                email: "seat1@test.com",
                locale: "en",
                timeZone: "America/Toronto",
                bookingSeat: { referenceUid: "booking-seat-1", data: {} },
              }),
              getMockBookingAttendee({
                id: 2,
                name: "Seat 2",
                email: "seat2@test.com",
                locale: "en",
                timeZone: "America/Toronto",
                bookingSeat: { referenceUid: "booking-seat-2", data: {} },
              }),
            ],
          },
        ],
        organizer,
        apps: [TestData.apps["google-calendar"]],
      })
    );

    // The organizer by the booking's uid, and the holder of the only other seat by its reference
    for (const { rescheduleUid, userId } of [
      { rescheduleUid: bookingUid, userId: organizer.id },
      { rescheduleUid: "booking-seat-1", userId: -1 },
    ]) {
      await expect(
        handleNewBooking({
          bookingData: getMockRequestDataForBooking({
            data: {
              eventTypeId: 1,
              rescheduleUid,
              start: `${plus2DateString}T04:00:00Z`,
              end: `${plus2DateString}T04:30:00Z`,
              responses: { ...bookerResponses, email: "seat1@test.com", name: "Seat 1" },
            },
          }),
          userId,
        })
      ).rejects.toMatchObject(refusal);
    }

    const booking = await prismaMock.booking.findFirst({
      where: { id: bookingId },
      select: { status: true },
    });
    expect(booking?.status).toEqual(BookingStatus.ACCEPTED);
    expect(await prismaMock.bookingSeat.findMany({ where: { bookingId } })).toHaveLength(2);
    expect(await prismaMock.booking.findMany()).toHaveLength(1);
  });

  test("refuses a recurring series through the recurring booking service", async () => {
    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slotInterval: 30,
            length: 30,
            recurringEvent: { freq: 2, count: 2, interval: 1 },
            users: [{ id: 101 }],
          },
        ],
        organizer: getTestOrganizer(),
        apps: [TestData.apps["google-calendar"]],
      })
    );

    const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
    const { dateString: plus8DateString } = getDate({ dateIncrement: 8 });
    const recurringEventId = uuidv4();
    const bookingData = [plus1DateString, plus8DateString].map((dateString) =>
      getMockRequestDataForBooking({
        data: {
          eventTypeId: 1,
          start: `${dateString}T04:00:00.000Z`,
          end: `${dateString}T04:30:00.000Z`,
          recurringEventId,
          recurringCount: 2,
          responses: bookerResponses,
        },
      })
    );

    await expect(
      getRecurringBookingService().createBooking({
        bookingData,
        bookingMeta: { userId: -1 },
        creationSource: "WEBAPP",
      })
    ).rejects.toMatchObject(refusal);

    expect(await prismaMock.booking.findMany()).toHaveLength(0);
  });

  test("still books an event type that is neither seated nor recurring", async () => {
    const handleNewBooking = getNewBookingHandler();

    await createBookingScenario(
      getScenarioData({
        eventTypes: [{ id: 1, slotInterval: 30, length: 30, users: [{ id: 101 }] }],
        organizer: getTestOrganizer(),
        apps: [TestData.apps["google-calendar"]],
      })
    );
    await mockCalendarToHaveNoBusySlots("googlecalendar", {});

    const createdBooking = await handleNewBooking({
      bookingData: getMockRequestDataForBooking({ data: { eventTypeId: 1, responses: bookerResponses } }),
    });

    expect(createdBooking).toEqual(
      expect.objectContaining({
        uid: expect.any(String),
        status: BookingStatus.ACCEPTED,
      })
    );
  });
});
