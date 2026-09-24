/**
 * The booking uid is the only capability behind /booking/<uid> (the booker's name, email and answers),
 * anonymous cancel (/api/cancel) and the public rating and no-show mutations. It must not be derivable
 * from public inputs: the host's username, the slot start and the time the booking was made.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  createBookingScenario,
  getBooker,
  getGoogleCalendarCredential,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import short from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import { describe, expect, vi } from "vitest";

import dayjs from "@calcom/dayjs";
import { test } from "@calcom/testing/lib/fixtures/fixtures";

import { getNewBookingHandler } from "./getNewBookingHandler";

const translator = short();
// short-uuid's flickrBase58 alphabet, padded to 22 characters
const SHORT_UUID_FORMAT = /^[1-9a-km-zA-HJ-NP-Z]{22}$/;

describe("handleNewBooking booking uid", () => {
  setupAndTeardown();

  test("two bookings of the same host, slot and millisecond get different, unguessable uids", async () => {
    const handleNewBooking = getNewBookingHandler();
    const booker = getBooker({ email: "booker@example.com", name: "Booker" });
    const organizer = getOrganizer({
      name: "Organizer",
      email: "organizer@example.com",
      username: "organizer",
      id: 101,
      schedules: [TestData.schedules.IstWorkHours],
      credentials: [getGoogleCalendarCredential()],
      selectedCalendars: [TestData.selectedCalendars.google],
    });

    await createBookingScenario(
      getScenarioData({
        eventTypes: [{ id: 1, slotInterval: 30, length: 30, users: [{ id: 101 }] }],
        organizer,
        apps: [TestData.apps["google-calendar"]],
      })
    );
    await mockCalendarToHaveNoBusySlots("googlecalendar", {
      create: { id: "MOCKED_GOOGLE_CALENDAR_EVENT_ID" },
    });

    const bookingData = getMockRequestDataForBooking({
      data: {
        user: organizer.username,
        eventTypeId: 1,
        responses: {
          email: booker.email,
          name: booker.name,
          location: { optionValue: "", value: "New York" },
        },
      },
    });

    // Everything the old uid was made from is the same for both bookings
    const now = Date.now();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const first = await handleNewBooking({ bookingData });
      // Free the slot again, so the same request can book it a second time
      await prismaMock.attendee.deleteMany({});
      await prismaMock.booking.deleteMany({});
      const second = await handleNewBooking({ bookingData });

      const oldDerivedUid = translator.fromUUID(
        uuidv5(`${organizer.username}:${dayjs(bookingData.start).utc().format()}:${now}`, uuidv5.URL)
      );

      expect(first.uid).toMatch(SHORT_UUID_FORMAT);
      expect(second.uid).toMatch(SHORT_UUID_FORMAT);
      expect(first.uid).not.toEqual(second.uid);
      expect(first.uid).not.toEqual(oldDerivedUid);
      expect(second.uid).not.toEqual(oldDerivedUid);
    } finally {
      dateNow.mockRestore();
    }
  });
});
