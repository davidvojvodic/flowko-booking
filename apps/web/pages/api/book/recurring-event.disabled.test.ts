import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  createBookingScenario,
  getBooker,
  getDate,
  getOrganizer,
  getScenarioData,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { createMockNextJsRequest } from "@calcom/testing/lib/bookingScenario/createMockNextJsRequest";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import { v4 as uuidv4 } from "uuid";
import { describe, expect } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { test } from "@calcom/testing/lib/fixtures/fixtures";

// Seated and recurring event types are off on this instance (IS_SEATS_AND_RECURRING_ENABLED), so the route
// refuses a recurring series even for an event type that was made recurring before the switch
describe("/api/book/recurring-event with seats and recurring events off", () => {
  setupAndTeardown();

  test("refuses to book a recurring series", async () => {
    const handleRecurringEventBooking = (await import("@calcom/web/pages/api/book/recurring-event"))
      .handleRecurringEventBooking;

    const booker = getBooker({
      email: "booker@example.com",
      name: "Booker",
    });

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
        organizer: getOrganizer({
          name: "Organizer",
          email: "organizer@example.com",
          id: 101,
          schedules: [TestData.schedules.IstWorkHours],
        }),
      })
    );

    const recurringEventId = uuidv4();
    const { req } = createMockNextJsRequest({
      method: "POST",
      body: [1, 8].map((dateIncrement) => {
        const { dateString } = getDate({ dateIncrement });
        return getMockRequestDataForBooking({
          data: {
            eventTypeId: 1,
            start: `${dateString}T04:00:00.000Z`,
            end: `${dateString}T04:30:00.000Z`,
            recurringEventId,
            recurringCount: 2,
            responses: {
              email: booker.email,
              name: booker.name,
              location: { optionValue: "", value: "New York" },
            },
          },
        });
      }),
    });

    await expect(handleRecurringEventBooking(req)).rejects.toMatchObject({
      statusCode: 400,
      message: ErrorCode.SeatsAndRecurringNotAvailable,
    });

    expect(await prismaMock.booking.findMany()).toHaveLength(0);
  });
});
