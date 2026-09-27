import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkActionManager, sanitizeEventData } from "../sdk-action-manager";

const BOOKING_UID = "k3v9QpZt7wXyB2mN4rLs8d";
const PHONE = "+38640111222";

/** What createBooking returns to useBookings, the shape the booking events are built from. */
const bookingResponse = {
  id: 42,
  uid: BOOKING_UID,
  userId: 7,
  eventTypeId: 5,
  title: "Pregled med Ana Novak in Salon",
  description: "Boli me zob",
  startTime: "2026-10-01T09:00:00.000Z",
  endTime: "2026-10-01T09:30:00.000Z",
  status: "ACCEPTED",
  paymentRequired: false,
  location: "Trubarjeva 1, Ljubljana",
  responses: {
    name: "Ana Novak",
    email: "ana@example.com",
    attendeePhoneNumber: PHONE,
    notes: "Boli me zob",
    guests: ["guest@example.com"],
  },
  attendees: [
    { name: "Ana Novak", email: "ana@example.com", phoneNumber: PHONE, timeZone: "Europe/Ljubljana" },
    { name: "", email: "guest@example.com", phoneNumber: null, timeZone: "Europe/Ljubljana" },
  ],
  user: { id: 7, name: "Salon", email: "organizer@example.com", username: "salon", timeZone: "Europe/Ljubljana" },
  userPrimaryEmail: "organizer@example.com",
  smsReminderNumber: PHONE,
  oneTimePassword: "one-time-password",
  references: [{ uid: "google-event-id", externalCalendarId: "organizer@example.com", credentialId: 11 }],
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
  metadata: { videoCallUrl: "https://meet.google.com/abc-defg-hij", utm_source: "newsletter" },
  customInputs: { "Your question": "Boli me zob" },
  iCalUID: `${BOOKING_UID}@example.com`,
  seatReferenceUid: "seat-reference-uid",
  paymentUid: "payment-uid",
  fromReschedule: "earlier-booking-uid",
  rescheduledBy: "ana@example.com",
};

/** The booking page's event type (event.data), which useBookings passes to the deprecated events whole. */
const eventTypeData = {
  id: 5,
  slug: "pregled",
  title: "Pregled",
  description: "Pregled zob",
  length: 30,
  locations: [{ type: "inPerson", address: "Trubarjeva 1, Ljubljana" }],
  users: [{ id: 7, email: "organizer@example.com" }],
  hosts: [{ user: { id: 8, email: "cohost@example.com" } }],
  owner: { id: 7, email: "organizer@example.com" },
  userId: 7,
  successRedirectUrl: "https://example.com/hvala",
};

const PUBLIC_BOOKING = {
  eventTypeId: 5,
  startTime: "2026-10-01T09:00:00.000Z",
  endTime: "2026-10-01T09:30:00.000Z",
  status: "ACCEPTED",
  paymentRequired: false,
};

/** Everything the embedding page must never learn about the booker, the host or the booking's uid. */
function expectNoPrivateData(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).not.toContain("@");
  expect(json).not.toContain(BOOKING_UID);
  expect(json).not.toContain("uid");
  expect(json).not.toContain("responses");
  expect(json).not.toContain("attendees");
  expect(json).not.toContain(PHONE);
  expect(json).not.toContain("Ana Novak");
  expect(json).not.toContain("Boli me zob");
  expect(json).not.toContain("Trubarjeva");
  expect(json).not.toContain("Salon");
  expect(json).not.toContain("meet.google.com");
  expect(json).not.toContain("one-time-password");
  expect(json).not.toContain("hvala");
}

describe("sanitizeEventData", () => {
  it("reduces the booking to its time and status", () => {
    const sanitized = sanitizeEventData({ booking: bookingResponse, confirmed: true });

    expect(sanitized).toEqual({ booking: PUBLIC_BOOKING, confirmed: true });
    expectNoPrivateData(sanitized);
  });

  it("keeps the shape of the deprecated bookingSuccessful payload with the reduced booking", () => {
    const sanitized = sanitizeEventData(
      {
        booking: bookingResponse,
        eventType: eventTypeData,
        date: "2026-10-01T09:00:00.000Z",
        duration: 30,
        organizer: { name: "Salon", email: "organizer@example.com", timeZone: "Europe/Ljubljana" },
        confirmed: true,
      },
      "bookingSuccessful"
    );

    expect(sanitized).toEqual({
      booking: PUBLIC_BOOKING,
      eventType: { id: 5, slug: "pregled" },
      date: "2026-10-01T09:00:00.000Z",
      duration: 30,
      organizer: { name: "Nameless", email: "Email-less", timeZone: "Europe/Ljubljana" },
      confirmed: true,
    });
    expectNoPrivateData(sanitized);
  });

  it.each(["bookingSuccessfulV2", "rescheduleBookingSuccessfulV2"])(
    "removes the uid and the title from %s",
    (eventName) => {
      const sanitized = sanitizeEventData(
        {
          uid: BOOKING_UID,
          title: "Pregled med Ana Novak in Salon",
          startTime: "2026-10-01T09:00:00.000Z",
          endTime: "2026-10-01T09:30:00.000Z",
          eventTypeId: 5,
          status: "ACCEPTED",
          paymentRequired: false,
          isRecurring: false,
        },
        eventName
      );

      expect(sanitized).toEqual({
        startTime: "2026-10-01T09:00:00.000Z",
        endTime: "2026-10-01T09:30:00.000Z",
        eventTypeId: 5,
        status: "ACCEPTED",
        paymentRequired: false,
        isRecurring: false,
      });
    }
  );

  it.each([
    "bookingSuccessfulV2",
    "rescheduleBookingSuccessfulV2",
    "dryRunBookingSuccessfulV2",
    "dryRunRescheduleBookingSuccessfulV2",
  ])("keeps only the allow-listed fields of %s, whatever the caller spreads into it", (eventName) => {
    const sanitized = sanitizeEventData(
      {
        ...bookingResponse,
        isRecurring: true,
        allBookings: [
          { startTime: "2026-10-01T09:00:00.000Z", endTime: "2026-10-01T09:30:00.000Z", uid: BOOKING_UID },
          { startTime: "2026-10-08T09:00:00.000Z", endTime: "2026-10-08T09:30:00.000Z", uid: "second-uid" },
        ],
      },
      eventName
    );

    expect(sanitized).toEqual({
      ...PUBLIC_BOOKING,
      isRecurring: true,
      allBookings: [
        { startTime: "2026-10-01T09:00:00.000Z", endTime: "2026-10-01T09:30:00.000Z" },
        { startTime: "2026-10-08T09:00:00.000Z", endTime: "2026-10-08T09:30:00.000Z" },
      ],
    });
    expectNoPrivateData(sanitized);
  });

  it("reduces the bookingCancelled payload, the cancellation reason included", () => {
    const sanitized = sanitizeEventData(
      {
        booking: {
          uid: BOOKING_UID,
          title: "Pregled med Ana Novak in Salon",
          startTime: "2026-10-01T09:00:00.000Z",
          endTime: "2026-10-01T09:30:00.000Z",
          status: "CANCELLED",
          cancellationReason: "Boli me zob, pridem drugič",
        },
        organizer: { name: "Salon", email: "Email-less", timeZone: "Europe/Ljubljana" },
        eventType: { id: 5, slug: "pregled", title: "Pregled" },
      },
      "bookingCancelled"
    );

    expect(sanitized).toEqual({
      booking: {
        startTime: "2026-10-01T09:00:00.000Z",
        endTime: "2026-10-01T09:30:00.000Z",
        status: "CANCELLED",
      },
      organizer: { name: "Nameless", email: "Email-less", timeZone: "Europe/Ljubljana" },
      eventType: { id: 5, slug: "pregled" },
    });
    expectNoPrivateData(sanitized);
  });

  it("reduces the event type of eventTypeSelected", () => {
    expect(sanitizeEventData({ eventType: eventTypeData }, "eventTypeSelected")).toEqual({
      eventType: { id: 5, slug: "pregled" },
    });
  });

  it("removes the booking's private fields from the top level of any other event", () => {
    const sanitized = sanitizeEventData({ ...bookingResponse, iframeHeight: 100 }, "someFutureEvent");

    expect(sanitized).toEqual({
      id: 42,
      userId: 7,
      eventTypeId: 5,
      startTime: "2026-10-01T09:00:00.000Z",
      endTime: "2026-10-01T09:30:00.000Z",
      status: "ACCEPTED",
      paymentRequired: false,
      iframeHeight: 100,
    });
    expectNoPrivateData(sanitized);
  });

  it("empties a booking or an event type that is not an object, and keeps a missing one missing", () => {
    expect(sanitizeEventData({ booking: BOOKING_UID, eventType: ["pregled"] })).toEqual({
      booking: {},
      eventType: {},
    });
    expect(sanitizeEventData({ booking: null, eventType: undefined, organizer: null })).toEqual({
      booking: null,
      eventType: undefined,
      organizer: null,
    });
  });

  it("does not modify the data it was given", () => {
    const data = { booking: { ...bookingResponse }, eventType: { ...eventTypeData } };
    sanitizeEventData(data, "bookingSuccessful");
    expect(data.booking.uid).toBe(BOOKING_UID);
    expect(data.booking.responses.email).toBe("ana@example.com");
    expect(data.eventType.title).toBe("Pregled");
  });

  it("passes other values through", () => {
    expect(sanitizeEventData({})).toEqual({});
    expect(sanitizeEventData({ iframeHeight: 100, iframeWidth: 200, isFirstTime: true })).toEqual({
      iframeHeight: 100,
      iframeWidth: 200,
      isFirstTime: true,
    });
    expect(sanitizeEventData({ eventId: 5, eventSlug: "pregled", slotsLoaded: true }, "bookerReady")).toEqual({
      eventId: 5,
      eventSlug: "pregled",
      slotsLoaded: true,
    });
    expect(sanitizeEventData(null)).toBeNull();
  });
});

describe("SdkActionManager.fire", () => {
  const listeners: [string, EventListener][] = [];
  const listen = (name: string) => {
    const listener = vi.fn();
    window.addEventListener(name, listener);
    listeners.push([name, listener]);
    return listener;
  };

  afterEach(() => {
    listeners.forEach(([name, listener]) => window.removeEventListener(name, listener));
    listeners.length = 0;
  });

  // The wildcard event is what embed-iframe.ts posts to the embedding page (sdkActionManager.on("*") → messageParent)
  function firedDetails(listener: ReturnType<typeof vi.fn>) {
    return listener.mock.calls.map(([event]) => (event as CustomEvent).detail);
  }

  it("sends every booking event and the wildcard event without the booker's data or the uid", () => {
    const manager = new SdkActionManager("ns");
    const wildcardListener = listen("CAL:ns:*");
    const eventListeners = [
      "bookingSuccessful",
      "bookingSuccessfulV2",
      "rescheduleBookingSuccessful",
      "rescheduleBookingSuccessfulV2",
      "dryRunBookingSuccessfulV2",
      "bookingCancelled",
    ].map((name) => listen(`CAL:ns:${name}`));

    // The payloads exactly as useBookings.ts and CancelBooking.tsx build them
    const deprecatedPayload = {
      booking: bookingResponse,
      eventType: eventTypeData,
      date: bookingResponse.startTime,
      duration: 30,
      organizer: { name: "Salon", email: "organizer@example.com", timeZone: "Europe/Ljubljana" },
      confirmed: true,
    };
    const v2Payload = {
      uid: bookingResponse.uid,
      title: bookingResponse.title,
      startTime: bookingResponse.startTime,
      endTime: bookingResponse.endTime,
      eventTypeId: bookingResponse.eventTypeId,
      status: bookingResponse.status,
      paymentRequired: bookingResponse.paymentRequired,
      isRecurring: false,
    };
    manager.fire("bookingSuccessful", deprecatedPayload);
    manager.fire("bookingSuccessfulV2", v2Payload);
    manager.fire("rescheduleBookingSuccessful", deprecatedPayload);
    manager.fire("rescheduleBookingSuccessfulV2", v2Payload);
    manager.fire("dryRunBookingSuccessfulV2", { ...v2Payload, uid: undefined } as never);
    manager.fire("bookingCancelled", {
      booking: { ...bookingResponse, cancellationReason: "Boli me zob" },
      organizer: { name: "Salon", email: "Email-less", timeZone: "Europe/Ljubljana" },
      eventType: eventTypeData,
    });

    eventListeners.forEach((listener) => expect(listener).toHaveBeenCalledTimes(1));
    const details = firedDetails(wildcardListener);
    expect(details).toHaveLength(6);
    details.forEach((detail) => expectNoPrivateData(detail.data));
    eventListeners.forEach((listener) => expectNoPrivateData(firedDetails(listener)[0].data));

    const [bookingSuccessful, bookingSuccessfulV2] = details;
    expect(bookingSuccessful.type).toBe("bookingSuccessful");
    expect(bookingSuccessful.data).toEqual({
      booking: PUBLIC_BOOKING,
      eventType: { id: 5, slug: "pregled" },
      date: "2026-10-01T09:00:00.000Z",
      duration: 30,
      organizer: { name: "Nameless", email: "Email-less", timeZone: "Europe/Ljubljana" },
      confirmed: true,
    });
    expect(bookingSuccessfulV2.type).toBe("bookingSuccessfulV2");
    expect(bookingSuccessfulV2.data).toEqual({
      startTime: "2026-10-01T09:00:00.000Z",
      endTime: "2026-10-01T09:30:00.000Z",
      eventTypeId: 5,
      status: "ACCEPTED",
      paymentRequired: false,
      isRecurring: false,
    });
  });
});
