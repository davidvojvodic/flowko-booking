import { describe, expect, it } from "vitest";

import { getBookerSubmittedEmails, toPublicBookingResponse } from "./publicBookingResponse";

const startTime = new Date("2026-10-01T09:00:00.000Z");
const endTime = new Date("2026-10-01T09:30:00.000Z");

const bookerResponses = {
  name: "Ana Novak",
  email: "ana@example.com",
  guests: ["guest@example.com"],
  notes: "Prosim za okno",
};

// Shaped like what RegularBookingService returns for a new booking that needs confirmation
const serviceResult = {
  id: 123,
  uid: "booking-uid",
  iCalUID: "ical-uid@Cal.diy",
  idempotencyKey: "idempotency-key",
  userId: 7,
  userUuid: "organizer-uuid",
  userPrimaryEmail: "organizer@gmail.com",
  eventTypeId: 5,
  title: "Striženje med Salon in Ana Novak",
  description: "Prosim za okno",
  customInputs: {},
  responses: bookerResponses,
  startTime,
  endTime,
  location: "Salonska ulica 1",
  createdAt: startTime,
  updatedAt: startTime,
  status: "PENDING" as const,
  paid: false,
  destinationCalendarId: 3,
  destinationCalendar: { externalId: "organizer@gmail.com", primaryEmail: "organizer@gmail.com" },
  oneTimePassword: "8a1b-one-time-password",
  smsReminderNumber: "+38640111222",
  metadata: { videoCallUrl: "https://meet.google.com/abc-defg-hij" },
  recurringEventId: null,
  rescheduledBy: null,
  cancelledBy: null,
  creationSource: "WEBAPP",
  user: {
    uuid: "organizer-uuid",
    email: null,
    name: "Salon",
    timeZone: "Europe/Ljubljana",
    username: "salon",
    isPlatformManaged: false,
  },
  attendees: [
    {
      id: 1,
      bookingId: 123,
      name: "Ana Novak",
      email: "ana@example.com",
      timeZone: "Europe/Ljubljana",
      locale: "sl",
      phoneNumber: "+38640111222",
      noShow: false,
    },
    {
      id: 2,
      bookingId: 123,
      name: "",
      email: "guest@example.com",
      timeZone: "Europe/Ljubljana",
      locale: "sl",
      phoneNumber: null,
      noShow: false,
    },
    {
      id: 3,
      bookingId: 123,
      name: "Stilistka Maja",
      email: "maja@salon.si",
      timeZone: "Europe/Ljubljana",
      locale: "sl",
      phoneNumber: null,
      noShow: false,
    },
  ],
  payment: [{ id: 9, uid: "payment-uid", data: { clientSecret: "pi_secret" } }],
  references: [
    {
      type: "google_calendar",
      uid: "google-event-id",
      meetingId: "google-event-id",
      externalCalendarId: "organizer@gmail.com",
      credentialId: 11,
    },
  ],
  luckyUsers: [7],
  isDryRun: false,
  troubleshooterData: { organizerUser: { id: 7 }, allHostUsers: [7, 8] },
  paymentRequired: false,
  seatReferenceUid: undefined,
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
  previousBooking: null,
};

const submittedBy = (responses: Record<string, unknown>) => getBookerSubmittedEmails({ responses });

describe("toPublicBookingResponse", () => {
  it("returns only the fields the booker UI reads", () => {
    const response = toPublicBookingResponse(serviceResult, submittedBy(bookerResponses));

    expect(response).toEqual({
      uid: "booking-uid",
      title: "Striženje med Salon in Ana Novak",
      description: "Prosim za okno",
      startTime,
      endTime,
      location: "Salonska ulica 1",
      status: "PENDING",
      eventTypeId: 5,
      responses: bookerResponses,
      user: { name: "Salon", timeZone: "Europe/Ljubljana", email: null },
      attendees: [
        { name: "Ana Novak", email: "ana@example.com", timeZone: "Europe/Ljubljana" },
        { name: "", email: "guest@example.com", timeZone: "Europe/Ljubljana" },
      ],
      paymentRequired: false,
      paymentUid: undefined,
      seatReferenceUid: undefined,
      isDryRun: false,
    });
  });

  it("never returns the one-time password, references, host internals or other attendees", () => {
    const serialised = JSON.stringify(toPublicBookingResponse(serviceResult, submittedBy(bookerResponses)));

    for (const secret of [
      "8a1b-one-time-password",
      "google-event-id",
      "externalCalendarId",
      "credentialId",
      "organizer@gmail.com",
      "organizer-uuid",
      "meet.google.com",
      "maja@salon.si",
      "pi_secret",
      "troubleshooterData",
      "luckyUsers",
      "userId",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("does not return the organizer's user row when an existing booking is returned", () => {
    const existingBooking = {
      ...serviceResult,
      user: {
        id: 7,
        name: "Salon",
        email: null,
        timeZone: "Europe/Ljubljana",
        twoFactorSecret: "encrypted-2fa-secret",
        backupCodes: "encrypted-backup-codes",
        metadata: { internal: true },
      },
      seatReferenceUid: "",
    };

    const response = toPublicBookingResponse(existingBooking, submittedBy(bookerResponses));

    expect(response.user).toEqual({ name: "Salon", timeZone: "Europe/Ljubljana", email: null });
    expect(JSON.stringify(response)).not.toContain("encrypted");
  });

  it("drops another person's answers when the booking was made by someone else", () => {
    // Ana's guest takes a seat on the booking Ana made: its answers, notes and title are Ana's
    const response = toPublicBookingResponse(
      serviceResult,
      submittedBy({ name: "Nekdo", email: "Guest@Example.com" })
    );

    expect(response.uid).toBe("booking-uid");
    expect(response.responses).toBeUndefined();
    expect(response.description).toBeUndefined();
    expect(response.title).toBeUndefined();
    expect(response.location).toBeUndefined();
    expect(response.attendees).toEqual([
      { name: "", email: "guest@example.com", timeZone: "Europe/Ljubljana" },
    ]);
    expect(JSON.stringify(response)).not.toContain("ana@example.com");
  });

  it("gives a later seat holder the event type's title instead of the first seat holder's", () => {
    const seatedBooking = { ...serviceResult, eventType: { title: "Striženje" } };

    const response = toPublicBookingResponse(
      seatedBooking,
      submittedBy({ name: "Marko Kos", email: "marko@example.com" })
    );

    expect(response.title).toBe("Striženje");
    expect(response.responses).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain("Ana Novak");
    // The booker's own booking keeps its own title
    expect(toPublicBookingResponse(seatedBooking, submittedBy(bookerResponses)).title).toBe(
      serviceResult.title
    );
  });

  it("matches the booker's email case-insensitively", () => {
    const response = toPublicBookingResponse(
      serviceResult,
      submittedBy({ ...bookerResponses, email: " ANA@example.com " })
    );

    expect(response.responses).toEqual(bookerResponses);
    expect(response.attendees.map((attendee) => attendee.email)).toContain("ana@example.com");
  });

  it("keeps a phone-only booker, stored under the placeholder address", () => {
    const phoneOnlyResponses = { name: "Ana Novak", attendeePhoneNumber: "+386 40 111 222" };
    const response = toPublicBookingResponse(
      {
        ...serviceResult,
        responses: { ...phoneOnlyResponses, email: "38640111222@sms.cal.com" },
        attendees: [
          { name: "Ana Novak", email: "38640111222@sms.cal.com", timeZone: "Europe/Ljubljana" },
        ],
      },
      submittedBy(phoneOnlyResponses)
    );

    expect(response.attendees).toEqual([
      { name: "Ana Novak", email: "38640111222@sms.cal.com", timeZone: "Europe/Ljubljana" },
    ]);
    expect(response.title).toBe(serviceResult.title);
  });

  it("keeps what the decoy success page reads from a short-circuited booking", () => {
    const decoy = {
      id: 0,
      uid: "decoy-uid",
      status: "ACCEPTED" as const,
      eventTypeId: 5,
      user: { name: "Alex Smith", timeZone: "UTC", email: null },
      userId: null,
      title: "Striženje",
      startTime,
      endTime,
      attendees: [{ id: 0, email: "ana@example.com", name: "Ana Novak", timeZone: "Europe/Ljubljana" }],
      oneTimePassword: null,
      responses: null,
      location: "Salonska ulica 1",
      references: [],
      payment: [],
      isDryRun: false,
      paymentRequired: false,
      luckyUsers: [],
      isShortCircuitedBooking: true,
    };

    const response = toPublicBookingResponse(decoy, submittedBy(bookerResponses));

    expect(response).toMatchObject({
      uid: "decoy-uid",
      isShortCircuitedBooking: true,
      title: "Striženje",
      location: "Salonska ulica 1",
      user: { name: "Alex Smith", timeZone: "UTC" },
      attendees: [{ name: "Ana Novak", email: "ana@example.com", timeZone: "Europe/Ljubljana" }],
    });
  });

  it("keeps the seat reference and payment uid", () => {
    const response = toPublicBookingResponse(
      {
        uid: "seated-uid",
        startTime,
        endTime,
        status: "ACCEPTED",
        responses: null,
        user: { name: "Salon", timeZone: "Europe/Ljubljana" },
        paymentRequired: true,
        paymentUid: "payment-uid",
        seatReferenceUid: "seat-reference-uid",
        isDryRun: false,
      },
      submittedBy(bookerResponses)
    );

    expect(response).toMatchObject({
      uid: "seated-uid",
      paymentRequired: true,
      paymentUid: "payment-uid",
      seatReferenceUid: "seat-reference-uid",
      attendees: [],
    });
    expect(response).not.toHaveProperty("isShortCircuitedBooking");
  });

  it("returns a null user when the booking has none", () => {
    expect(toPublicBookingResponse({ uid: "x", user: null }, new Set()).user).toBeNull();
  });
});

describe("getBookerSubmittedEmails", () => {
  it("collects the booker's email and guests from responses", () => {
    expect(getBookerSubmittedEmails({ responses: bookerResponses })).toEqual(
      new Set(["ana@example.com", "guest@example.com"])
    );
  });

  it("adds the placeholder address of a phone number", () => {
    expect(getBookerSubmittedEmails({ responses: { attendeePhoneNumber: "+386 40 111 222" } })).toEqual(
      new Set(["38640111222@sms.cal.com"])
    );
  });

  it("reads every booking of a recurring request", () => {
    expect(
      getBookerSubmittedEmails([
        { responses: { email: "ana@example.com" } },
        { responses: { email: "ana@example.com", guests: ["guest@example.com"] } },
      ])
    ).toEqual(new Set(["ana@example.com", "guest@example.com"]));
  });

  it("reads the legacy top-level props", () => {
    expect(getBookerSubmittedEmails({ email: "Ana@Example.com", guests: ["guest@example.com"] })).toEqual(
      new Set(["ana@example.com", "guest@example.com"])
    );
  });

  it("ignores values that are not email strings", () => {
    expect(
      getBookerSubmittedEmails({ responses: { email: 42, guests: [null, { email: "x" }, ""] } })
    ).toEqual(new Set());
    expect(getBookerSubmittedEmails(undefined)).toEqual(new Set());
  });
});
