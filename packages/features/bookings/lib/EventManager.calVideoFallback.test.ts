/**
 * Flowko (B4): EventManager hands a video location it has no credential for (an integrations:* type no app
 * claims, a missing app) and Google Meet without Google Calendar to Cal Video. That fallback must not
 * happen while the admin keeps Cal Video (the daily-video App row) switched off, and the booking must go
 * ahead without a video meeting rather than fail.
 */
import { prisma } from "@calcom/prisma/__mocks__/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/features/watchlist/lib/utils/normalization", () => ({
  normalizeEmail: vi.fn(),
  extractDomainFromEmail: vi.fn(),
  normalizeDomain: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/lib/service/GlobalBlockingService", () => ({
  GlobalBlockingService: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/lib/freeEmailDomainCheck/checkIfFreeEmailDomain", () => ({
  checkIfFreeEmailDomain: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/operations/check-if-users-are-blocked.controller", () => ({
  checkIfUsersAreBlocked: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/lib/telemetry", () => ({
  sentrySpan: vi.fn(),
}));
vi.mock("@calcom/lib/i18n", () => ({
  locales: ["en"],
  localeOptions: [{ value: "en", label: "English" }],
  defaultLocaleOption: { value: "en", label: "English" },
}));

import { MeetLocationType } from "@calcom/app-store/locations";
import {
  createMeeting,
  isCalVideoEnabled,
  updateMeeting,
} from "@calcom/features/conferencing/lib/videoClient";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { PartialBooking } from "@calcom/types/EventManager";
import EventManager from "./EventManager";

vi.mock("@calcom/prisma", () => ({
  prisma,
}));

vi.mock("@calcom/features/conferencing/lib/videoClient", () => ({
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
  isCalVideoEnabled: vi.fn(),
}));

const mockedCreateMeeting = vi.mocked(createMeeting);
const mockedUpdateMeeting = vi.mocked(updateMeeting);
const mockedIsCalVideoEnabled = vi.mocked(isCalVideoEnabled);

const DAILY_ROOM = { type: "daily_video", id: "room", password: "", url: "https://flowko.daily.co/room" };

function calEvent(location: string): CalendarEvent {
  return {
    type: "30min",
    title: "Meeting",
    startTime: "2026-10-01T10:00:00Z",
    endTime: "2026-10-01T10:30:00Z",
    organizer: { email: "host@example.com", name: "Host", timeZone: "UTC", language: { locale: "en" } },
    attendees: [],
    location,
    destinationCalendar: null,
  } as unknown as CalendarEvent;
}

describe("EventManager Cal Video fallback", () => {
  let eventManager: EventManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // A tenant with no video app installed: only the global Cal Video credential exists
    eventManager = new EventManager({ credentials: [], destinationCalendar: null });
    mockedCreateMeeting.mockImplementation(async (credential, event) => ({
      appName: "Cal Video",
      type: credential.type,
      uid: "uid",
      originalEvent: { ...event, location: "integrations:daily" },
      success: true,
      createdEvent: DAILY_ROOM,
      credentialId: credential.id,
    }));
  });

  describe("an integrations:* location no app claims", () => {
    it("gets no video meeting while Cal Video is disabled, and the booking still goes ahead", async () => {
      mockedIsCalVideoEnabled.mockResolvedValue(false);
      const evt = calEvent("integrations:dailyx");

      const result = await eventManager.create(evt, { skipCalendarEvent: true });

      expect(mockedCreateMeeting).not.toHaveBeenCalled();
      expect(result).toEqual({ results: [], referencesToCreate: [] });
      expect(evt.videoCallData).toBeUndefined();
    });

    it("still falls back to Cal Video while Cal Video is enabled", async () => {
      mockedIsCalVideoEnabled.mockResolvedValue(true);
      const evt = calEvent("integrations:dailyx");

      const result = await eventManager.create(evt, { skipCalendarEvent: true });

      // FAKE_DAILY_CREDENTIAL (the event object itself is updated to the room afterwards)
      expect(mockedCreateMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ id: 0, appId: "daily-video", type: "daily_video" }),
        expect.anything()
      );
      expect(result.results).toHaveLength(1);
      expect(evt.videoCallData).toEqual(DAILY_ROOM);
    });

    it("gets no video meeting on a location change while Cal Video is disabled", async () => {
      mockedIsCalVideoEnabled.mockResolvedValue(false);
      const booking = { id: 1, references: [] } as unknown as PartialBooking;

      await expect(eventManager.updateLocation(calEvent("integrations:dailyx"), booking)).resolves.toEqual({
        results: [],
        referencesToCreate: [],
      });
      expect(mockedCreateMeeting).not.toHaveBeenCalled();
    });

    it("gets no video meeting update on a reschedule while Cal Video is disabled", async () => {
      mockedIsCalVideoEnabled.mockResolvedValue(false);
      prisma.booking.findUnique.mockResolvedValue({
        id: 1,
        userId: 1,
        attendees: [],
        location: "integrations:dailyx",
        endTime: new Date("2026-10-01T10:30:00Z"),
        references: [],
        destinationCalendar: null,
        payment: [],
        eventType: null,
      } as never);
      const evt = { ...calEvent("integrations:dailyx"), uid: "booking-uid" } as CalendarEvent;

      const result = await eventManager.reschedule(evt, "booking-uid");

      expect(mockedUpdateMeeting).not.toHaveBeenCalled();
      expect(result.results).toEqual([]);
    });
  });

  describe("Google Meet without Google Calendar as the destination calendar", () => {
    it("keeps its Meet location and gets no Cal Video room while Cal Video is disabled", async () => {
      mockedIsCalVideoEnabled.mockResolvedValue(false);
      const evt = calEvent(MeetLocationType);

      const result = await eventManager.create(evt, { skipCalendarEvent: true });

      expect(mockedCreateMeeting).not.toHaveBeenCalled();
      expect(result.results).toEqual([]);
      expect(evt.location).toBe(MeetLocationType);
    });

    it("still falls back to Cal Video while Cal Video is enabled", async () => {
      mockedIsCalVideoEnabled.mockResolvedValue(true);
      const evt = calEvent(MeetLocationType);

      await eventManager.create(evt, { skipCalendarEvent: true });

      expect(mockedCreateMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ appId: "daily-video" }),
        expect.objectContaining({ location: "integrations:daily" })
      );
    });
  });
});
