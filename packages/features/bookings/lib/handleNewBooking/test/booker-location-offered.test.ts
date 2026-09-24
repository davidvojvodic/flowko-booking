/**
 * Flowko (B1): the booker's location answer used to reach booking unchecked, so an anonymous booker could
 * send { value: "integrations:google:meet" } (or Cal Video, or any app's location) on an in-person event type
 * and booking ran that app: EventManager asked Google Calendar for a Meet link. The booker now picks one of
 * the event type's own locations, or gives the address, phone number or text one of them asks for.
 */
import i18nMock from "@calcom/testing/lib/__mocks__/libServerI18n";
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

import type { TFunction } from "i18next";
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
    language,
    userId,
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
    /** The language the form was filled in */
    language?: string;
    /** The signed-in user who books (the organizer, when they reschedule) */
    userId?: number;
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
          ...(language && { language }),
          responses: {
            email: booker.email,
            name: booker.name,
            ...(value !== undefined && {
              location: { value, optionValue } as { value: string; optionValue: "" },
            }),
          },
        },
      }),
      ...(userId && { userId }),
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

  // A reschedule sends back the booking's saved answer (useInitialFormValues), and the form may show no other
  // choice (a single location that asks nothing is hidden), so an answer the event type no longer offers
  // counts as none there instead of refusing every reschedule
  describe("rescheduling a booking whose saved answer is no longer offered", () => {
    const previousBooking = (location: string) => {
      const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
      return [
        {
          uid: "booking-to-move",
          eventTypeId: 1,
          userId: 101,
          status: BookingStatus.ACCEPTED,
          startTime: `${plus1DateString}T05:00:00.000Z`,
          endTime: `${plus1DateString}T05:30:00.000Z`,
          location,
          references: [
            getMockBookingReference({
              type: "google_calendar",
              uid: "MOCK_ID",
              externalCalendarId: "organizer@google-calendar.com",
              credentialId: 1,
            }),
          ],
          attendees: [
            getMockBookingAttendee({
              id: 1,
              name: "Booker",
              email: "booker@example.com",
              timeZone: "Europe/Ljubljana",
              locale: "en",
            }),
          ],
        },
      ];
    };
    const expectNoConference = (calendar: Awaited<ReturnType<typeof book>>["calendar"]) => {
      const calendarEvents = [
        ...calendar.createEventCalls.map((call) => call.args.calEvent),
        ...calendar.updateEventCalls.map((call) => call.args.event),
      ];
      expect(calendarEvents.length).toBeGreaterThan(0);
      for (const calEvent of calendarEvents) expect(calEvent.conferenceData).toBeUndefined();
    };

    test("books the event type's in-person location for a Cal Video booking, with no Cal Video room", async () => {
      const { booking, calendar, calVideo } = await book({
        locations: inPersonOnly,
        value: BookingLocations.CalVideo,
        bookings: previousBooking(BookingLocations.CalVideo),
        rescheduleUid: "booking-to-move",
      });
      const created = await booking;
      expect(created.location).toBe("Slovenska 1, Ljubljana");
      expect(calVideo.createMeetingCalls).toHaveLength(0);
      expect(calVideo.updateMeetingCalls).toHaveLength(0);
      expectNoConference(calendar);
    });

    test("books the event type's in-person location, not Google Meet, when the reschedule sends Meet", async () => {
      const { booking, calendar } = await book({
        locations: inPersonOnly,
        value: BookingLocations.GoogleMeet,
        bookings: previousBooking("Slovenska 1, Ljubljana"),
        rescheduleUid: "booking-to-move",
      });
      expect((await booking).location).toBe("Slovenska 1, Ljubljana");
      expectNoConference(calendar);
    });

    test("books the event type's own location for an attendee-phone booking on an attendee-address event type", async () => {
      const { booking } = await book({
        locations: [{ type: "attendeeInPerson" }],
        value: "phone",
        optionValue: "+38640123456",
        bookings: previousBooking("+38640123456"),
        rescheduleUid: "booking-to-move",
      });
      const created = await booking;
      expect(created.status).toBe(BookingStatus.ACCEPTED);
      expect(created.location).toBe("attendeeInPerson");
    });

    test("books the organizer's default for an in-person answer on an event type without locations", async () => {
      const { booking, calVideo } = await book({
        value: "inPerson",
        bookings: previousBooking("Slovenska 1, Ljubljana"),
        rescheduleUid: "booking-to-move",
      });
      expect((await booking).location).toBe(BookingLocations.CalVideo);
      expect(calVideo.createMeetingCalls).toHaveLength(1);
    });

    test("books the location the organizer picks by its label in their own language", async () => {
      // Labels in the language asked for, so the organizer's (sl) and the attendee's (en) differ
      i18nMock.getTranslation.mockImplementation(
        async (locale: string) => ((key: string) => `${locale}:${key}`) as TFunction
      );
      const { booking } = await book({
        // The same organizer-input type twice: the form sends the private one's label
        locations: [
          { type: "inPerson", address: "Slovenska 1, Ljubljana", displayLocationPublicly: true },
          { type: "inPerson", address: "Trubarjeva 5, Maribor" },
        ],
        value: "sl:in_person",
        language: "sl",
        userId: 101,
        bookings: previousBooking("Slovenska 1, Ljubljana"),
        rescheduleUid: "booking-to-move",
      });
      // What booking keeps for a label the form sends (upstream), not the event type's default location
      expect((await booking).location).toBe("sl:in_person");
    });

    test("still books the saved answer while the event type offers it", async () => {
      const { booking } = await book({
        locations: [...inPersonOnly, { type: BookingLocations.GoogleMeet }],
        value: "inPerson",
        bookings: previousBooking("Slovenska 1, Ljubljana"),
        rescheduleUid: "booking-to-move",
      });
      expect((await booking).location).toBe("Slovenska 1, Ljubljana");
    });
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

    // The owner saves an in-person address, a link or a phone number as free text, so it can read as an app's
    // location type: booking uses that value, and EventManager ran the app it names
    describe.each([
      ["in-person address", { type: "inPerson", address: BookingLocations.GoogleMeet }],
      ["link", { type: "link", link: BookingLocations.GoogleMeet }],
      ["organizer phone number", { type: "userPhone", hostPhoneNumber: BookingLocations.GoogleMeet }],
    ])("an offered location whose saved %s names a switched-off app", (_, location) => {
      test.each([
        ["picked", location.type],
        ["by default", undefined],
      ])("books no video location (%s)", async (_, value) => {
        const { booking, calendar, calVideo } = await book({
          locations: [location],
          value,
          isGoogleMeetEnabled: false,
        });
        const created = await booking;
        expect(created.location).toBe("");
        expect((await prismaMock.booking.findUnique({ where: { uid: created.uid! } }))?.location).toBe("");
        expectNoMeet(calendar);
        expect(calVideo.createMeetingCalls).toHaveLength(0);
      });
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

    test("doesn't carry a switched-off app's old meeting link into the booking a booker moves", async () => {
      const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
      const oldMeetUrl = "https://meet.google.com/old-meeting";
      const { booking, calendar } = await book({
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
                meetingUrl: oldMeetUrl,
                externalCalendarId: "organizer@google-calendar.com",
                credentialId: 1,
              }),
              getMockBookingReference({
                type: "google_meet_video",
                uid: "MOCK_ID",
                meetingUrl: oldMeetUrl,
                credentialId: 1,
              }),
            ],
            attendees: [getMockBookingAttendee({ id: 1, name: "Booker", email: "booker@example.com" })],
          },
        ],
        rescheduleUid: "booking-with-meet",
      });
      expect((await booking).location).toBe("");
      const calendarEvents = [
        ...calendar.createEventCalls.map((call) => call.args.calEvent),
        ...calendar.updateEventCalls.map((call) => call.args.event),
      ];
      expect(calendarEvents.length).toBeGreaterThan(0);
      for (const calEvent of calendarEvents) expect(calEvent.videoCallData).toBeUndefined();
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
