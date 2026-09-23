import { describe, expect, it } from "vitest";

import { getBookingCancelledEventData } from "../getBookingCancelledEventData";

describe("getBookingCancelledEventData", () => {
  it("sends only the fields that identify the cancelled booking", () => {
    // What the booking page passes: its bookingInfo and eventType props
    const bookingCancelledEventProps = {
      booking: {
        id: 123,
        uid: "booking-uid",
        title: "Striženje",
        startTime: "2026-10-01T09:00:00.000Z",
        endTime: "2026-10-01T09:30:00.000Z",
        status: "ACCEPTED",
        userPrimaryEmail: "salon.calendar@gmail.com",
        smsReminderNumber: "+38640111222",
        responses: { name: "Ana Novak", email: "ana@example.com" },
        user: { id: 7, name: "Salon", email: "salon.owner@gmail.com", username: "salon" },
        attendees: [{ name: "Ana Novak", email: "ana@example.com", phoneNumber: "+38640111222" }],
      },
      organizer: { name: "Salon", email: "salon.calendar@gmail.com", timeZone: "Europe/Ljubljana" },
      eventType: {
        id: 5,
        slug: "strizenje",
        title: "Striženje",
        userId: 7,
        users: [{ id: 7, email: "salon.owner@gmail.com" }],
        hosts: [{ user: { id: 8, email: "maja.private@gmail.com" } }],
        owner: { id: 7, email: "salon.owner@gmail.com" },
        metadata: { apps: { stripe: { credentialId: 11 } } },
      },
    };

    const data = getBookingCancelledEventData(bookingCancelledEventProps, "Zbolela sem");

    expect(data).toEqual({
      booking: {
        uid: "booking-uid",
        title: "Striženje",
        startTime: "2026-10-01T09:00:00.000Z",
        endTime: "2026-10-01T09:30:00.000Z",
        status: "ACCEPTED",
        cancellationReason: "Zbolela sem",
      },
      organizer: { name: "Salon", email: "Email-less", timeZone: "Europe/Ljubljana" },
      eventType: { id: 5, slug: "strizenje", title: "Striženje" },
    });
    expect(JSON.stringify(data)).not.toContain("@gmail.com");
    expect(JSON.stringify(data)).not.toContain("+386");
  });

  it("copes with a booking or event type that isn't an object", () => {
    expect(
      getBookingCancelledEventData(
        { booking: null, organizer: { name: "Salon", email: "x@example.com" }, eventType: undefined },
        ""
      )
    ).toEqual({
      booking: { cancellationReason: "" },
      organizer: { name: "Salon", email: "Email-less" },
      eventType: {},
    });
  });
});
