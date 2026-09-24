import type { CalendarEvent } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appEnabledBySlug, findUnique, getVideoAdapters, zoomCreateMeeting, dailyCreateMeeting } = vi.hoisted(
  () => {
    const appEnabledBySlug: Record<string, boolean> = {};
    return {
      appEnabledBySlug,
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        where.slug in appEnabledBySlug ? { enabled: appEnabledBySlug[where.slug] } : null
      ),
      getVideoAdapters: vi.fn(),
      zoomCreateMeeting: vi.fn(),
      dailyCreateMeeting: vi.fn(),
    };
  }
);

vi.mock("@calcom/prisma", () => ({ prisma: { app: { findUnique } } }));
vi.mock("@calcom/app-store/getVideoAdapters", () => ({ getVideoAdapters }));
vi.mock("@calcom/app-store/dailyvideo/lib/getDailyAppKeys", () => ({
  getDailyAppKeys: vi.fn(async () => ({ api_key: "daily-key", scale_plan: "false" })),
}));
vi.mock("@calcom/emails/integration-email-service", () => ({ sendBrokenIntegrationEmail: vi.fn() }));

import { createMeeting, isCalVideoEnabled } from "./videoClient";

const DAILY_ROOM = { type: "daily_video", id: "room", password: "", url: "https://flowko.daily.co/room" };

function credential(appId: string, type: string): CredentialPayload {
  return {
    id: 7,
    appId,
    type,
    userId: 1,
    user: { email: "host@example.com" },
    teamId: null,
    key: {},
    encryptedKey: null,
    invalid: false,
    delegationCredentialId: null,
  } as CredentialPayload;
}

function calEvent(location: string): CalendarEvent {
  return {
    type: "30min",
    title: "Meeting",
    startTime: "2026-10-01T10:00:00Z",
    endTime: "2026-10-01T10:30:00Z",
    organizer: { email: "host@example.com", name: "Host", timeZone: "UTC", language: { locale: "en" } },
    attendees: [],
    location,
    uid: "booking-uid",
  } as unknown as CalendarEvent;
}

describe("videoClient Cal Video fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const slug of Object.keys(appEnabledBySlug)) delete appEnabledBySlug[slug];
    zoomCreateMeeting.mockResolvedValue({ type: "zoom_video", id: "zoom", password: "", url: "https://zoom" });
    dailyCreateMeeting.mockResolvedValue(DAILY_ROOM);
    getVideoAdapters.mockImplementation(async ([cred]: CredentialPayload[]) => [
      { createMeeting: cred.appId === "daily-video" ? dailyCreateMeeting : zoomCreateMeeting },
    ]);
  });

  it("isCalVideoEnabled follows the daily-video App row", async () => {
    await expect(isCalVideoEnabled()).resolves.toBe(false);
    appEnabledBySlug["daily-video"] = false;
    await expect(isCalVideoEnabled()).resolves.toBe(false);
    appEnabledBySlug["daily-video"] = true;
    await expect(isCalVideoEnabled()).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { slug: "daily-video" }, select: { enabled: true } });
  });

  it("makes no Daily room for a switched-off video app while Cal Video is switched off too", async () => {
    appEnabledBySlug.zoom = false;
    appEnabledBySlug["daily-video"] = false;
    const evt = calEvent("integrations:zoom");

    const result = await createMeeting(credential("zoom", "zoom_video"), evt);

    expect(zoomCreateMeeting).not.toHaveBeenCalled();
    expect(dailyCreateMeeting).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, createdEvent: undefined });
    expect(evt.location).toBe("integrations:zoom");
  });

  it("makes no Daily room for Cal Video's own credential while Cal Video is switched off", async () => {
    appEnabledBySlug["daily-video"] = false;

    const result = await createMeeting(credential("daily-video", "daily_video"), calEvent("integrations:daily"));

    expect(dailyCreateMeeting).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, createdEvent: undefined });
  });

  it("still falls back to Cal Video for a switched-off video app while Cal Video is enabled", async () => {
    appEnabledBySlug.zoom = false;
    appEnabledBySlug["daily-video"] = true;
    const evt = calEvent("integrations:zoom");

    const result = await createMeeting(credential("zoom", "zoom_video"), evt);

    expect(zoomCreateMeeting).not.toHaveBeenCalled();
    expect(dailyCreateMeeting).toHaveBeenCalledTimes(1);
    expect(result.createdEvent).toEqual(DAILY_ROOM);
    expect(evt.location).toBe("integrations:daily");
  });
});
