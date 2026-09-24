/**
 * Flowko (B1): the booker's location answer used to reach booking unchecked, so an anonymous booker could
 * send { value: "integrations:google:meet" } (or Cal Video, or any app's location) on an in-person event type
 * and booking ran that app: EventManager asked Google Calendar for a Meet link. The booker now picks one of
 * the event type's own locations, or gives the address, phone number or text one of them asks for.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  BookingLocations,
  createBookingScenario,
  getBooker,
  getDate,
  getGoogleCalendarCredential,
  getGoogleMeetCredential,
  getMockBookingAttendee,
  getMockBookingReference,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  mockSuccessfulVideoMeetingCreation,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import { describe, expect, test } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { BookingStatus } from "@calcom/prisma/enums";

import { getNewBookingHandler } from "./getNewBookingHandler";

const inPersonOnly = [{ type: "inPerson", address: "Slovenska 1, Ljubljana" }];

describe("handleNewBooking with a booker-picked location", () => {
  setupAndTeardown();

  async function book({
    locations,
    value,
    optionValue = "",
    organizerMetadata,
    bookings,
    rescheduleUid,
    fromHostCalendar = false,
    isGoogleMeetEnabled = true,
  }: {
    /** The event type's locations (none when undefined) */
    locations?: Record<string, unknown>[];
    /** The booker's location answer */
    value?: string;
    optionValue?: string;
    organizerMetadata?: Record<string, unknown>;
    /** Existing bookings, and the one to move */
    bookings?: Parameters<typeof getScenarioData>[0]["bookings"];
    rescheduleUid?: string;
    /** Called the way calendar sync moves a booking the host moved in their own calendar */
    fromHostCalendar?: boolean;
    /** Google Meet's App row; every other app is enabled */
    isGoogleMeetEnabled?: boolean;
  }) {
    const handleNewBooking = getNewBookingHandler();
    const booker = getBooker({ email: "booker@example.com", name: "Booker" });
    const organizer = getOrganizer({
      name: "Organizer",
      email: "organizer@example.com",
      id: 101,
      schedules: [TestData.schedules.IstWorkHours],
      credentials: [getGoogleCalendarCredential(), getGoogleMeetCredential()],
      selectedCalendars: [TestData.selectedCalendars.google],
      destinationCalendar: { integration: "google_calendar", externalId: "organizer@google-calendar.com" },
      metadata: organizerMetadata,
    });

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          { id: 1, slotInterval: 30, length: 30, users: [{ id: 101 }], ...(locations && { locations }) },
        ],
        organizer,
        bookings,
        // Every app is enabled by default: the refusals come from the event type's locations alone
        apps: [
          TestData.apps["google-calendar"],
          { ...TestData.apps["google-meet"], enabled: isGoogleMeetEnabled },
          TestData.apps["daily-video"],
        ],
      })
    );
    const calendar = await mockCalendarToHaveNoBusySlots("googlecalendar", {
      create: { id: "MOCKED_GOOGLE_CALENDAR_EVENT_ID" },
    });
    const calVideo = mockSuccessfulVideoMeetingCreation({
      metadataLookupKey: "dailyvideo",
      videoMeetingData: { id: "MOCK_ID", password: "MOCK_PASS", url: "http://mock-dailyvideo.example.com" },
    });

    const booking = handleNewBooking({
      bookingData: getMockRequestDataForBooking({
        data: {
          eventTypeId: 1,
          rescheduleUid,
          responses: {
            email: booker.email,
            name: booker.name,
            ...(value !== undefined && {
              location: { value, optionValue } as { value: string; optionValue: "" },
            }),
          },
        },
      }),
      ...(fromHostCalendar && {
        skipCalendarSyncTaskCreation: true,
        skipAvailabilityCheck: true,
        skipEventLimitsCheck: true,
      }),
    });
    return { booking, calendar, calVideo };
  }

  async function expectRefused({ booking, calendar, calVideo }: Awaited<ReturnType<typeof book>>) {
    await expect(booking).rejects.toThrow(ErrorCode.RequestBodyInvalid);
    expect(await prismaMock.booking.findMany()).toHaveLength(0);
    expect(calendar.createEventCalls).toHaveLength(0);
    expect(calVideo.createMeetingCalls).toHaveLength(0);
  }

  test.each([
    BookingLocations.GoogleMeet,
    BookingLocations.CalVideo,
    BookingLocations.ZoomVideo,
    "conferencing",
  ])("refuses %s on an in-person event type, and books nothing", async (value) => {
    await expectRefused(await book({ locations: inPersonOnly, value }));
  });

  test("refuses an app's location sent as the booker's own address", async () => {
    await expectRefused(
      await book({
        locations: [{ type: "attendeeInPerson" }],
        value: "attendeeInPerson",
        optionValue: BookingLocations.GoogleMeet,
      })
    );
  });

  test("refuses the booker's own input for a location that doesn't ask for it", async () => {
    await expectRefused(
      await book({ locations: inPersonOnly, value: "inPerson", optionValue: BookingLocations.GoogleMeet })
    );
  });

  test("books the offered in-person location the booker picks", async () => {
    const { booking } = await book({ locations: inPersonOnly, value: "inPerson" });
    expect((await booking).location).toBe("Slovenska 1, Ljubljana");
  });

  test("books the offered in-person location by default", async () => {
    const { booking } = await book({ locations: inPersonOnly });
    expect((await booking).location).toBe("Slovenska 1, Ljubljana");
  });

  test("books Google Meet when the event type offers it", async () => {
    const { booking, calendar } = await book({
      locations: [...inPersonOnly, { type: BookingLocations.GoogleMeet }],
      value: BookingLocations.GoogleMeet,
    });
    expect((await booking).location).toBe(BookingLocations.GoogleMeet);
    expect(calendar.createEventCalls).toHaveLength(1);
  });

  test("books the booker's own phone number for an attendee-phone event type", async () => {
    const { booking } = await book({
      locations: [{ type: "phone" }],
      value: "phone",
      optionValue: "+38640123456",
    });
    const created = await booking;
    expect(created.location).toBe("+38640123456");
    expect((await prismaMock.booking.findUnique({ where: { uid: created.uid! } }))?.location).toBe(
      "+38640123456"
    );
  });

  test("books the booker's own address for an attendee-address event type", async () => {
    const { booking } = await book({
      locations: [{ type: "attendeeInPerson" }],
      value: "attendeeInPerson",
      optionValue: "Trubarjeva 5, Maribor",
    });
    expect((await booking).location).toBe("Trubarjeva 5, Maribor");
  });

  test("refuses Google Meet on an event type without locations", async () => {
    await expectRefused(await book({ value: BookingLocations.GoogleMeet }));
  });

  // With no locations booking uses the organizer's default, which a client may also name
  test.each([
    "conferencing",
    BookingLocations.CalVideo,
  ])("books the organizer's default when a booker names it (%s) on an event type without locations", async (value) => {
    const { booking, calVideo } = await book({ value });
    expect((await booking).location).toBe(BookingLocations.CalVideo);
    expect(calVideo.createMeetingCalls).toHaveLength(1);
  });

  test("keeps the location a move in the host's own calendar brings (calendar sync)", async () => {
    const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
    const { booking } = await book({
      locations: inPersonOnly,
      // What CalendarSyncService sends: the calendar event's location as both option and input
      value: "Kavarna Union, Ljubljana",
      optionValue: "Kavarna Union, Ljubljana",
      bookings: [
        {
          uid: "booking-moved-in-calendar",
          eventTypeId: 1,
          userId: 101,
          status: BookingStatus.ACCEPTED,
          startTime: `${plus1DateString}T05:00:00.000Z`,
          endTime: `${plus1DateString}T05:30:00.000Z`,
          location: "Slovenska 1, Ljubljana",
          attendees: [getMockBookingAttendee({ id: 1, name: "Booker", email: "booker@example.com" })],
        },
      ],
      rescheduleUid: "booking-moved-in-calendar",
      fromHostCalendar: true,
    });
    expect((await booking).location).toBe("Kavarna Union, Ljubljana");
  });

  describe("with an app the admin switched off", () => {
    const meetDefault = { defaultConferencingApp: { appSlug: "google-meet" } };
    const expectNoMeet = (calendar: Awaited<ReturnType<typeof book>>["calendar"]) => {
      expect(calendar.createEventCalls).toHaveLength(1);
      const { calEvent } = calendar.createEventCalls[0].args;
      expect(calEvent.location).toBe("");
      expect(calEvent.conferenceData).toBeUndefined();
    };

    test("books the organizer's default app on a conferencing event type while it is enabled", async () => {
      const { booking, calendar } = await book({
        locations: [{ type: "conferencing" }],
        value: "conferencing",
        organizerMetadata: meetDefault,
      });
      expect((await booking).location).toBe(BookingLocations.GoogleMeet);
      expect(calendar.createEventCalls[0].args.calEvent.location).toBe(BookingLocations.GoogleMeet);
    });

    test.each([
      ["picked", "conferencing"],
      ["by default", undefined],
    ])("books no video location for a switched-off default app on a conferencing event type (%s)", async (_, value) => {
      const { booking, calendar, calVideo } = await book({
        locations: [{ type: "conferencing" }],
        value,
        organizerMetadata: meetDefault,
        isGoogleMeetEnabled: false,
      });
      const created = await booking;
      expect(created.location).toBe("");
      expect(created.status).toBe(BookingStatus.ACCEPTED);
      expectNoMeet(calendar);
      expect(calVideo.createMeetingCalls).toHaveLength(0);
    });

    test("books no video location for a switched-off app the event type still offers", async () => {
      const { booking, calendar } = await book({
        locations: [...inPersonOnly, { type: BookingLocations.GoogleMeet }],
        value: BookingLocations.GoogleMeet,
        isGoogleMeetEnabled: false,
      });
      expect((await booking).location).toBe("");
      expectNoMeet(calendar);
    });

    test("still refuses a switched-off app the event type doesn't offer", async () => {
      await expectRefused(
        await book({
          locations: inPersonOnly,
          value: BookingLocations.GoogleMeet,
          isGoogleMeetEnabled: false,
        })
      );
    });

    test("keeps the old location instead of a switched-off app a move in the host's calendar brings", async () => {
      const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
      const { booking, calendar } = await book({
        locations: inPersonOnly,
        value: BookingLocations.GoogleMeet,
        optionValue: BookingLocations.GoogleMeet,
        isGoogleMeetEnabled: false,
        bookings: [
          {
            uid: "booking-moved-in-calendar",
            eventTypeId: 1,
            userId: 101,
            status: BookingStatus.ACCEPTED,
            startTime: `${plus1DateString}T05:00:00.000Z`,
            endTime: `${plus1DateString}T05:30:00.000Z`,
            location: "Slovenska 1, Ljubljana",
            attendees: [getMockBookingAttendee({ id: 1, name: "Booker", email: "booker@example.com" })],
          },
        ],
        rescheduleUid: "booking-moved-in-calendar",
        fromHostCalendar: true,
      });
      // A rescheduled booking without a location keeps the one it had (createBooking)
      expect((await booking).location).toBe("Slovenska 1, Ljubljana");
      // calendar sync moves the booking without writing back to the host's calendar
      expect(calendar.createEventCalls).toHaveLength(0);
    });

    test("doesn't bring a switched-off app back from the booking a booker moves", async () => {
      const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
      const { booking, calendar } = await book({
        // Booked with Meet while Meet was on; the admin has switched it off since
        locations: [...inPersonOnly, { type: BookingLocations.GoogleMeet }],
        value: BookingLocations.GoogleMeet,
        isGoogleMeetEnabled: false,
        bookings: [
          {
            uid: "booking-with-meet",
            eventTypeId: 1,
            userId: 101,
            status: BookingStatus.ACCEPTED,
            startTime: `${plus1DateString}T05:00:00.000Z`,
            endTime: `${plus1DateString}T05:30:00.000Z`,
            location: BookingLocations.GoogleMeet,
            references: [
              getMockBookingReference({
                type: "google_calendar",
                uid: "MOCK_ID",
                meetingUrl: "https://GOOGLE_MEET_URL_IN_CALENDAR_EVENT",
                externalCalendarId: "organizer@google-calendar.com",
                credentialId: 1,
              }),
            ],
            attendees: [getMockBookingAttendee({ id: 1, name: "Booker", email: "booker@example.com" })],
          },
        ],
        rescheduleUid: "booking-with-meet",
      });
      const created = await booking;
      expect(created.location).toBe("");
      expect((await prismaMock.booking.findUnique({ where: { uid: created.uid! } }))?.location).toBe("");
      const calendarEvents = [
        ...calendar.createEventCalls.map((call) => call.args.calEvent),
        ...calendar.updateEventCalls.map((call) => call.args.event),
      ];
      expect(calendarEvents.length).toBeGreaterThan(0);
      for (const calEvent of calendarEvents) {
        expect(calEvent.location).not.toBe(BookingLocations.GoogleMeet);
        expect(calEvent.conferenceData).toBeUndefined();
      }
    });
  });
});
