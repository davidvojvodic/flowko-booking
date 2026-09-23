import { afterEach, describe, expect, it, vi } from "vitest";

import { SdkActionManager, sanitizeEventData } from "../sdk-action-manager";

const booking = {
  uid: "booking-uid",
  title: "Striženje",
  startTime: "2026-10-01T09:00:00.000Z",
  oneTimePassword: "one-time-password",
  references: [{ uid: "google-event-id", externalCalendarId: "organizer@gmail.com", credentialId: 11 }],
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
  metadata: { videoCallUrl: "https://meet.google.com/abc-defg-hij", utm_source: "newsletter" },
};

describe("sanitizeEventData", () => {
  it("removes the one-time password, references and video call link from the booking", () => {
    const data = { booking, date: "2026-10-01", confirmed: false };

    expect(sanitizeEventData(data)).toEqual({
      booking: {
        uid: "booking-uid",
        title: "Striženje",
        startTime: "2026-10-01T09:00:00.000Z",
        metadata: { utm_source: "newsletter" },
      },
      date: "2026-10-01",
      confirmed: false,
    });
  });

  it("removes them from the top level of the event data", () => {
    expect(
      sanitizeEventData({ uid: "booking-uid", videoCallUrl: "https://meet.google.com/x", references: [] })
    ).toEqual({ uid: "booking-uid" });
  });

  it("does not modify the data it was given", () => {
    const data = { booking };
    sanitizeEventData(data);
    expect(data.booking.oneTimePassword).toBe("one-time-password");
    expect(data.booking.metadata.videoCallUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("passes other values through", () => {
    expect(sanitizeEventData({})).toEqual({});
    expect(sanitizeEventData({ iframeHeight: 100, iframeWidth: 200, isFirstTime: true })).toEqual({
      iframeHeight: 100,
      iframeWidth: 200,
      isFirstTime: true,
    });
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

  it("sends the event and the wildcard event without the private booking fields", () => {
    const manager = new SdkActionManager("ns");
    const eventListener = listen("CAL:ns:bookingSuccessful");
    const wildcardListener = listen("CAL:ns:*");

    manager.fire("bookingSuccessful", {
      booking,
      eventType: {},
      date: "2026-10-01",
      duration: 30,
      organizer: { name: "Salon", email: "Email-less", timeZone: "Europe/Ljubljana" },
      confirmed: false,
    });

    for (const listener of [eventListener, wildcardListener]) {
      expect(listener).toHaveBeenCalledTimes(1);
      const { detail } = listener.mock.calls[0][0] as CustomEvent;
      expect(detail.type).toBe("bookingSuccessful");
      expect(detail.data.booking).toEqual({
        uid: "booking-uid",
        title: "Striženje",
        startTime: "2026-10-01T09:00:00.000Z",
        metadata: { utm_source: "newsletter" },
      });
      expect(JSON.stringify(detail)).not.toContain("meet.google.com");
    }
  });
});
