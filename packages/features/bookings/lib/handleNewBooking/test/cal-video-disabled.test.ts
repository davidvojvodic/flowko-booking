/**
 * Flowko (B4): an event type with no location (or the organizer-default "conferencing" with no usable
 * default app) used to book "integrations:daily" whatever the daily-video App row said. With Cal Video
 * switched off that made a Daily call that failed, the only EventManager result failed, and the booker got
 * no confirmation email. While Cal Video is disabled such a booking now has no video location and goes
 * ahead normally; while it is enabled, Cal Video stays the default.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  BookingLocations,
  createBookingScenario,
  getBooker,
  getGoogleMeetCredential,
  getOrganizer,
  getScenarioData,
  mockSuccessfulVideoMeetingCreation,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import {
  expectICalUIDAsString,
  expectSuccessfulBookingCreationEmails,
} from "@calcom/testing/lib/bookingScenario/expects";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import { describe, expect } from "vitest";

import { test } from "@calcom/testing/lib/fixtures/fixtures";

import { getNewBookingHandler } from "./getNewBookingHandler";

const calVideoApp = (enabled: boolean) => ({ ...TestData.apps["daily-video"], enabled });

describe("handleNewBooking without a usable location", () => {
  setupAndTeardown();

  async function bookEventTypeWithoutLocation({
    calVideoEnabled,
    organizerMetadata,
    credentials = [],
    destinationCalendar,
    apps = [],
    locations,
    bookerLocation,
  }: {
    calVideoEnabled: boolean;
    organizerMetadata?: Record<string, unknown>;
    credentials?: ReturnType<typeof getGoogleMeetCredential>[];
    destinationCalendar?: { integration: string; externalId: string };
    apps?: unknown[];
    /** The event type's locations (none by default) */
    locations?: Record<string, unknown>[];
    /** The location value the booker sends (none by default) */
    bookerLocation?: string;
  }) {
    const handleNewBooking = getNewBookingHandler();
    const booker = getBooker({ email: "booker@example.com", name: "Booker" });
    const organizer = getOrganizer({
      name: "Organizer",
      email: "organizer@example.com",
      id: 101,
      schedules: [TestData.schedules.IstWorkHours],
      credentials,
      selectedCalendars: [],
      destinationCalendar,
      metadata: organizerMetadata,
    });

    await createBookingScenario(
      getScenarioData({
        eventTypes: [{ id: 1, slotInterval: 30, length: 30, users: [{ id: 101 }], ...(locations && { locations }) }],
        organizer,
        apps: [...apps, calVideoApp(calVideoEnabled)],
      })
    );
    const calVideo = mockSuccessfulVideoMeetingCreation({
      metadataLookupKey: "dailyvideo",
      videoMeetingData: { id: "MOCK_ID", password: "MOCK_PASS", url: "http://mock-dailyvideo.example.com" },
    });

    const createdBooking = await handleNewBooking({
      bookingData: getMockRequestDataForBooking({
        data: {
          eventTypeId: 1,
          responses: {
            email: booker.email,
            name: booker.name,
            ...(bookerLocation !== undefined && { location: { optionValue: "", value: bookerLocation } }),
          },
        },
      }),
    });
    const bookingInDb = await prismaMock.booking.findUnique({ where: { uid: createdBooking.uid! } });
    return { booker, organizer, createdBooking, bookingInDb, calVideo };
  }

  test("books no video location while Cal Video is disabled, and still sends the emails", async ({
    emails,
  }) => {
    const { booker, organizer, createdBooking, bookingInDb, calVideo } = await bookEventTypeWithoutLocation({
      calVideoEnabled: false,
    });

    expect(calVideo.createMeetingCalls).toHaveLength(0);
    expect(createdBooking.location).toBe("");
    expect(bookingInDb?.location).toBe("");
    expect(bookingInDb?.status).toBe("ACCEPTED");
    expectSuccessfulBookingCreationEmails({
      booking: { uid: createdBooking.uid! },
      booker,
      organizer,
      emails,
      iCalUID: expectICalUIDAsString(createdBooking.iCalUID),
    });
  });

  test("still books Cal Video while Cal Video is enabled", async () => {
    const { createdBooking, calVideo } = await bookEventTypeWithoutLocation({ calVideoEnabled: true });

    expect(calVideo.createMeetingCalls).toHaveLength(1);
    expect(createdBooking.location).toBe(BookingLocations.CalVideo);
  });

  test("books no video location for a Google Meet default without Google Calendar while Cal Video is disabled", async () => {
    const { createdBooking, calVideo } = await bookEventTypeWithoutLocation({
      calVideoEnabled: false,
      credentials: [getGoogleMeetCredential()],
      destinationCalendar: { integration: "office365_calendar", externalId: "organizer@outlook.com" },
      organizerMetadata: { defaultConferencingApp: { appSlug: "google-meet" } },
      apps: [TestData.apps["google-meet"]],
    });

    expect(calVideo.createMeetingCalls).toHaveLength(0);
    expect(createdBooking.location).toBe("");
  });

  // Flowko (B4 review): getLocationValueForDB turns any blank location value into Cal Video, and a booker
  // can pick an offered one; neither may book Cal Video while it is disabled.
  test("books no video location for a blank location value while Cal Video is disabled, and sends the emails", async ({
    emails,
  }) => {
    const { booker, organizer, createdBooking, bookingInDb, calVideo } = await bookEventTypeWithoutLocation({
      calVideoEnabled: false,
      locations: [{ type: "inPerson", address: " " }],
    });

    expect(calVideo.createMeetingCalls).toHaveLength(0);
    expect(createdBooking.location).toBe("");
    expect(bookingInDb?.location).toBe("");
    expect(bookingInDb?.status).toBe("ACCEPTED");
    expectSuccessfulBookingCreationEmails({
      booking: { uid: createdBooking.uid! },
      booker,
      organizer,
      emails,
      iCalUID: expectICalUIDAsString(createdBooking.iCalUID),
    });
  });

  test("books no video location for a booker-picked Cal Video location while Cal Video is disabled, and sends the emails", async ({
    emails,
  }) => {
    const { booker, organizer, createdBooking, bookingInDb, calVideo } = await bookEventTypeWithoutLocation({
      calVideoEnabled: false,
      locations: [{ type: "inPerson", address: "Ljubljana" }, { type: BookingLocations.CalVideo }],
      bookerLocation: BookingLocations.CalVideo,
    });

    expect(calVideo.createMeetingCalls).toHaveLength(0);
    expect(createdBooking.location).toBe("");
    expect(bookingInDb?.location).toBe("");
    expect(bookingInDb?.status).toBe("ACCEPTED");
    expectSuccessfulBookingCreationEmails({
      booking: { uid: createdBooking.uid! },
      booker,
      organizer,
      emails,
      iCalUID: expectICalUIDAsString(createdBooking.iCalUID),
    });
  });

  test("books no video location for a Cal Video default app while Cal Video is disabled", async () => {
    const { createdBooking, calVideo } = await bookEventTypeWithoutLocation({
      calVideoEnabled: false,
      organizerMetadata: { defaultConferencingApp: { appSlug: "daily-video" } },
    });

    expect(calVideo.createMeetingCalls).toHaveLength(0);
    expect(createdBooking.location).toBe("");
  });

  test("still books a blank location value as Cal Video while Cal Video is enabled", async () => {
    const { createdBooking, calVideo } = await bookEventTypeWithoutLocation({
      calVideoEnabled: true,
      locations: [{ type: "inPerson", address: " " }],
    });

    expect(calVideo.createMeetingCalls).toHaveLength(1);
    expect(createdBooking.location).toBe(BookingLocations.CalVideo);
  });
});
