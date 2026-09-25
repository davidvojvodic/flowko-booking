/**
 * Flowko (B4 review): with the real videoClient and Daily adapter, an explicit Cal Video location must not
 * reach the Daily API while the daily-video App row is disabled, even when the row still holds Daily keys.
 * Every tenant has the global Cal Video credential, so the location always finds a credential; before the
 * fix create() kept a failed daily_video result (reference uid "") and a reschedule of that booking made a
 * new Daily room (POST /rooms/ for the empty uid).
 */
import type { PrismaClient } from "@calcom/prisma/client";
import type { CalendarEvent } from "@calcom/types/Calendar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockReset } from "vitest-mock-extended";
import type { DeepMockProxy } from "vitest-mock-extended";

const prismaHolder = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@calcom/prisma", async () => {
  const { mockDeep } = await import("vitest-mock-extended");
  prismaHolder.current = prismaHolder.current ?? mockDeep<PrismaClient>();
  return { prisma: prismaHolder.current, default: prismaHolder.current };
});
vi.mock("@calcom/emails/integration-email-service", () => ({
  sendBrokenIntegrationEmail: vi.fn(),
  sendDisabledAppEmail: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/lib/service/GlobalBlockingService", () => ({
  GlobalBlockingService: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/operations/check-if-users-are-blocked.controller", () => ({
  checkIfUsersAreBlocked: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/lib/telemetry", () => ({ sentrySpan: vi.fn() }));

import EventManager from "./EventManager";

const DAILY_KEYS = { api_key: "daily-key", scale_plan: "false" };
const DAILY_ROOM = {
  id: "r",
  name: "room1",
  api_created: true,
  privacy: "public",
  url: "https://flowko.daily.co/room1",
  created_at: "2026-09-24",
  config: { exp: 1, enable_chat: true, enable_knocking: true, enable_prejoin_ui: true, enable_pip_ui: true },
};

function calEvent(location: string): CalendarEvent {
  return {
    type: "30min",
    title: "Meeting",
    uid: "booking-uid",
    startTime: "2026-10-01T10:00:00Z",
    endTime: "2026-10-01T10:30:00Z",
    organizer: {
      id: 1,
      email: "host@example.com",
      name: "Host",
      timeZone: "UTC",
      language: { locale: "en", translate: (s: string) => s },
    },
    attendees: [],
    location,
    destinationCalendar: null,
  } as unknown as CalendarEvent;
}

describe("EventManager with Cal Video disabled (real videoClient and Daily adapter)", () => {
  const prisma = () => prismaHolder.current as DeepMockProxy<PrismaClient>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function setCalVideo(enabled: boolean) {
    // The daily-video App row, keys present: the B4 threat model is "Daily keys set, app disabled"
    prisma().app.findUnique.mockResolvedValue({ enabled, keys: DAILY_KEYS } as never);
  }

  beforeEach(() => {
    mockReset(prisma());
    prisma().membership.findFirst.mockResolvedValue(null);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const body = String(url).includes("meeting-tokens") ? { token: "tok" } : DAILY_ROOM;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("create(): an explicit Cal Video location gets no meeting, no failed result and no reference", async () => {
    setCalVideo(false);
    const eventManager = new EventManager({ credentials: [], destinationCalendar: null } as never);

    const result = await eventManager.create(calEvent("integrations:daily"), { skipCalendarEvent: true });

    expect(result.results).toEqual([]);
    expect(result.referencesToCreate).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reschedule(): no Daily room for a booking whose Cal Video create had failed", async () => {
    setCalVideo(false);
    prisma().booking.findUnique.mockResolvedValue({
      id: 1,
      userId: 1,
      attendees: [],
      location: "integrations:daily",
      endTime: new Date("2026-10-01T10:30:00Z"),
      references: [
        {
          type: "daily_video",
          uid: "",
          meetingId: null,
          meetingPassword: null,
          meetingUrl: null,
          externalCalendarId: null,
          credentialId: null,
        },
      ],
      destinationCalendar: null,
      payment: [],
      eventType: null,
    } as never);
    const eventManager = new EventManager({ credentials: [], destinationCalendar: null } as never);

    const result = await eventManager.reschedule(calEvent("integrations:daily"), "booking-uid");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
  });

  it("create(): still makes the Daily room while Cal Video is enabled", async () => {
    setCalVideo(true);
    const eventManager = new EventManager({ credentials: [], destinationCalendar: null } as never);

    const result = await eventManager.create(calEvent("integrations:daily"), { skipCalendarEvent: true });

    expect(result.results).toEqual([expect.objectContaining({ type: "daily_video", success: true })]);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.daily.co/v1/rooms", expect.anything());
  });
});
