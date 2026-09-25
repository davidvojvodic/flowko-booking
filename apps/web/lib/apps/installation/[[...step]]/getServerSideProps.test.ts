import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@calcom/prisma", () => ({
  default: { app: { findUnique: mocks.findUnique } },
  prisma: { app: { findUnique: mocks.findUnique } },
}));

import { getAppAndMetadata } from "./getServerSideProps";

// The row as stored once GOOGLE_API_CREDENTIALS is set: its keys hold the platform's OAuth client secret
const googleCalendarRow = {
  slug: "google-calendar",
  enabled: true,
  dirName: "googlecalendar",
  keys: { client_id: "id.apps.googleusercontent.com", client_secret: "GOCSPX-secret" },
};

describe("/apps/installation getAppAndMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Answer like Prisma: return only the selected fields
    mocks.findUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) =>
      Object.fromEntries(Object.keys(select).map((key) => [key, googleCalendarRow[key as keyof typeof googleCalendarRow]]))
    );
  });

  it("never selects the App row's keys", async () => {
    await getAppAndMetadata("google-calendar");
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique.mock.calls[0][0].select).not.toHaveProperty("keys");
  });

  it("returns no client secret in the app it hands to the page props", async () => {
    const { app } = await getAppAndMetadata("google-calendar");
    expect(app).toEqual({ slug: "google-calendar", enabled: true, dirName: "googlecalendar" });
    expect(JSON.stringify(app)).not.toContain("GOCSPX-secret");
  });
});
