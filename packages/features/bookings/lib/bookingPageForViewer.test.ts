import { describe, expect, it } from "vitest";

import {
  getHostEmails,
  normaliseEmail,
  toBookingInfoForViewer,
  toEventTypeForViewer,
  toHostForViewer,
} from "./bookingPageForViewer";

const organizer = {
  id: 7,
  name: "Salon",
  email: "salon.owner@gmail.com",
  username: "salon",
  hideBranding: false,
  theme: null,
  brandColor: "#123456",
  darkBrandColor: null,
  timeZone: "Europe/Ljubljana",
  isPlatformManaged: false,
};
const coHost = { ...organizer, id: 8, name: "Maja", email: "maja.private@gmail.com", username: "maja" };

// Shaped like the success page's eventType prop for a collective team event
const eventType = {
  id: 5,
  title: "Striženje",
  userId: 7,
  hideOrganizerEmail: true,
  users: [organizer, coHost],
  hosts: [{ user: organizer }, { user: coHost }],
  owner: organizer,
  team: { id: 3, name: "Salon Lepota" },
  metadata: {
    apps: {
      stripe: { enabled: true, price: 2500, currency: "eur", credentialId: 11 },
      gtm: { enabled: true, trackingId: "GTM-XXXX", credentialId: 12 },
    },
  },
  locations: [
    { type: "inPerson", address: "Tajna ulica 5", displayLocationPublicly: false },
    { type: "userPhone", hostPhoneNumber: "+38641999888" },
    { type: "inPerson", address: "Salonska ulica 1", displayLocationPublicly: true },
  ],
};

// Shaped like getUserBooking's result: the booker, their guest, and the co-host stored as an attendee
const bookingInfo = {
  id: 123,
  uid: "booking-uid",
  title: "Striženje med Salon in Ana Novak",
  startTime: "2026-10-01T09:00:00.000Z",
  userPrimaryEmail: "salon.calendar@gmail.com",
  smsReminderNumber: "+38640111222",
  cancelledBy: null,
  rescheduledBy: "maja.private@gmail.com",
  responses: { name: "Ana Novak", email: "ana@example.com" },
  user: {
    id: 7,
    name: "Salon",
    email: "salon.owner@gmail.com",
    username: "salon",
    timeZone: "Europe/Ljubljana",
    avatarUrl: null,
  },
  attendees: [
    { name: "Ana Novak", email: "ana@example.com", timeZone: "Europe/Ljubljana", phoneNumber: "+38640111222" },
    { name: "Gost", email: "guest@example.com", timeZone: "Europe/Ljubljana", phoneNumber: "+38640333444" },
    { name: "Maja", email: "Maja.Private@gmail.com", timeZone: "Europe/Ljubljana", phoneNumber: "+38641555666" },
  ],
  eventType: { hideOrganizerEmail: true },
  assignmentReason: [{ reasonEnum: "REASSIGNED", reasonString: "Reassigned by maja.private@gmail.com" }],
};

const hostEmails = getHostEmails({
  eventType,
  organizerEmails: [bookingInfo.user.email, bookingInfo.userPrimaryEmail],
});

function getPropsForViewer({
  canViewHostDetails,
  hideOrganizerEmail = true,
  viewerEmails = new Set<string>(),
}: {
  canViewHostDetails: boolean;
  hideOrganizerEmail?: boolean;
  viewerEmails?: Set<string>;
}) {
  return {
    bookingInfo: toBookingInfoForViewer(bookingInfo, {
      canViewHostDetails,
      hideOrganizerEmail,
      hostEmails,
      viewerEmails,
    }),
    eventType: toEventTypeForViewer({ ...eventType, hideOrganizerEmail }, canViewHostDetails),
  };
}

describe("booking page props for a viewer who isn't a host", () => {
  it("contain no host email or user id when the event type hides the organizer's email", () => {
    const props = getPropsForViewer({ canViewHostDetails: false });
    const serialised = JSON.stringify(props);

    for (const hostEmail of ["salon.owner@gmail.com", "salon.calendar@gmail.com", "maja.private@gmail.com"]) {
      expect(serialised.toLowerCase()).not.toContain(hostEmail);
    }
    expect(props.bookingInfo.user).not.toHaveProperty("id");
    expect(props.bookingInfo.user?.email).toBeNull();
    expect(props.bookingInfo.userPrimaryEmail).toBeNull();
    expect(props.bookingInfo.rescheduledBy).toBeNull();
    expect(props.bookingInfo.assignmentReason).toEqual([]);
    expect(props.eventType).not.toHaveProperty("userId");
    for (const host of [...props.eventType.users, ...props.eventType.hosts.map((h) => h.user), props.eventType.owner]) {
      expect(host).not.toHaveProperty("id");
      expect(host).not.toHaveProperty("email");
    }
  });

  it("keep what the page shows: names, the booker's own details and the branding", () => {
    const props = getPropsForViewer({
      canViewHostDetails: false,
      viewerEmails: new Set([normaliseEmail("Ana@Example.com")]),
    });

    expect(props.bookingInfo.user).toEqual({
      name: "Salon",
      email: null,
      username: "salon",
      timeZone: "Europe/Ljubljana",
      avatarUrl: null,
    });
    expect(props.bookingInfo.attendees).toEqual([
      {
        name: "Ana Novak",
        email: "ana@example.com",
        timeZone: "Europe/Ljubljana",
        phoneNumber: "+38640111222",
        isHost: false,
      },
      {
        name: "Gost",
        email: "guest@example.com",
        timeZone: "Europe/Ljubljana",
        phoneNumber: null,
        isHost: false,
      },
      { name: "Maja", email: null, timeZone: "Europe/Ljubljana", phoneNumber: null, isHost: true },
    ]);
    expect(props.eventType.users.map((user) => user.name)).toEqual(["Salon", "Maja"]);
    expect(props.eventType.users[0]).toMatchObject({ username: "salon", brandColor: "#123456" });
    expect(props.eventType.team).toEqual({ id: 3, name: "Salon Lepota" });
    expect(props.bookingInfo.uid).toBe("booking-uid");
    expect(props.bookingInfo.responses).toEqual(bookingInfo.responses);
  });

  it("drop every phone number but the viewer's own", () => {
    const props = getPropsForViewer({ canViewHostDetails: false });

    expect(props.bookingInfo.attendees.map((attendee) => attendee.phoneNumber)).toEqual([null, null, null]);
    expect(props.bookingInfo.smsReminderNumber).toBeNull();
    expect(JSON.stringify(props)).not.toContain("+3864");
  });

  it("keep the organizer's email, which the page shows, when the event type doesn't hide it", () => {
    const props = getPropsForViewer({ canViewHostDetails: false, hideOrganizerEmail: false });

    expect(props.bookingInfo.user?.email).toBe("salon.owner@gmail.com");
    expect(props.bookingInfo.userPrimaryEmail).toBe("salon.calendar@gmail.com");
    expect(props.bookingInfo.attendees[2]).toMatchObject({ email: "Maja.Private@gmail.com", isHost: true });
    // Ids and the hosts' emails on the event type are never shown
    expect(props.bookingInfo.user).not.toHaveProperty("id");
    expect(JSON.stringify(props.eventType)).not.toContain("@gmail.com");
  });

  it("strip app credential ids and private location details", () => {
    const props = getPropsForViewer({ canViewHostDetails: false });

    expect(props.eventType.metadata).toEqual({
      apps: {
        stripe: { enabled: true, price: 2500, currency: "eur" },
        gtm: { enabled: true, trackingId: "GTM-XXXX" },
      },
    });
    expect(props.eventType.locations).toEqual([
      { type: "inPerson", displayLocationPublicly: false },
      { type: "userPhone" },
      { type: "inPerson", address: "Salonska ulica 1", displayLocationPublicly: true },
    ]);
  });

  it("do not modify the data they were built from", () => {
    getPropsForViewer({ canViewHostDetails: false });

    expect(bookingInfo.user.id).toBe(7);
    expect(bookingInfo.attendees[2].email).toBe("Maja.Private@gmail.com");
    expect(eventType.metadata.apps.stripe.credentialId).toBe(11);
    expect(eventType.owner.email).toBe("salon.owner@gmail.com");
  });
});

describe("booking page props for a host", () => {
  it("keep every field and only tag the attendees who are hosts", () => {
    const props = getPropsForViewer({ canViewHostDetails: true });

    expect(props.bookingInfo).toEqual({
      ...bookingInfo,
      attendees: bookingInfo.attendees.map((attendee, index) => ({ ...attendee, isHost: index === 2 })),
    });
    expect(props.eventType).toEqual(eventType);
  });
});

describe("getHostEmails", () => {
  it("collects the hosts', owner's and organizer's emails, normalised", () => {
    expect(hostEmails).toEqual(
      new Set(["salon.owner@gmail.com", "maja.private@gmail.com", "salon.calendar@gmail.com"])
    );
  });
});

describe("toHostForViewer", () => {
  it("removes the id and email", () => {
    expect(toHostForViewer(coHost, false)).toEqual({
      name: "Maja",
      username: "maja",
      hideBranding: false,
      theme: null,
      brandColor: "#123456",
      darkBrandColor: null,
      timeZone: "Europe/Ljubljana",
      isPlatformManaged: false,
    });
    expect(toHostForViewer(coHost, true)).toBe(coHost);
  });
});
