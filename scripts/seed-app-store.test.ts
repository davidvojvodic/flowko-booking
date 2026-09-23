import prismock from "@calcom/testing/lib/__mocks__/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import seedAppStore from "./seed-app-store";

vi.mock("@calcom/app-store/appStoreMetaData", () => ({
  appStoreMetadata: {
    gtm: { slug: "gtm", dirName: "gtm", categories: ["analytics"], type: "gtm_analytics" },
    jitsivideo: { slug: "jitsi", dirName: "jitsivideo", categories: ["conferencing"], type: "jitsi_video" },
    googlecalendar: {
      slug: "google-calendar",
      dirName: "googlecalendar",
      categories: ["calendar"],
      type: "google_calendar",
    },
    googlevideo: {
      slug: "google-meet",
      dirName: "googlevideo",
      categories: ["conferencing"],
      type: "google_video",
    },
  },
}));

const googleKeys = {
  client_id: "client-id.apps.googleusercontent.com",
  client_secret: "client-secret",
  redirect_uris: ["https://booking.flowko.si/api/integrations/googlecalendar/callback"],
};

const getApps = async () => {
  const apps = await prismock.app.findMany();
  return Object.fromEntries(apps.map((app) => [app.slug, app]));
};

describe("seed-app-store", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_API_CREDENTIALS", JSON.stringify({ web: googleKeys }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables only google-calendar and creates every other app disabled", async () => {
    await seedAppStore();

    const apps = await getApps();
    expect(apps["google-calendar"]).toMatchObject({ enabled: true, keys: googleKeys });
    expect(apps["google-meet"]).toMatchObject({ enabled: false, keys: googleKeys });
    for (const slug of ["gtm", "jitsi", "make", "apple-calendar", "caldav-calendar", "wipe-my-cal"]) {
      expect(apps[slug]?.enabled, slug).toBe(false);
    }
  });

  it("leaves the enabled flag of existing apps as the admin set it", async () => {
    await prismock.app.create({
      data: { slug: "gtm", dirName: "gtm", categories: ["analytics"], enabled: true },
    });
    await prismock.app.create({
      data: { slug: "jitsi", dirName: "jitsivideo", categories: ["conferencing"], enabled: false },
    });
    await prismock.app.create({
      data: { slug: "make", dirName: "make", categories: ["automation"], enabled: false },
    });

    await seedAppStore();
    // A second boot must not change anything either
    await prismock.app.update({ where: { slug: "google-meet" }, data: { enabled: true } });
    await seedAppStore();

    const apps = await getApps();
    expect(apps.gtm.enabled).toBe(true);
    expect(apps.jitsi.enabled).toBe(false);
    expect(apps.make.enabled).toBe(false);
    expect(apps["google-meet"].enabled).toBe(true);
    expect(apps["google-calendar"].enabled).toBe(true);
  });

  it("keeps google-calendar following GOOGLE_API_CREDENTIALS on every boot", async () => {
    await prismock.app.create({
      data: { slug: "google-calendar", dirName: "googlecalendar", categories: ["calendar"], enabled: false },
    });

    await seedAppStore();

    expect((await getApps())["google-calendar"]).toMatchObject({ enabled: true, keys: googleKeys });
  });

  it("enables every app with valid keys for the E2E seed", async () => {
    await seedAppStore({ syncEnabledFromKeys: true });

    const apps = await getApps();
    for (const slug of ["google-calendar", "google-meet", "gtm", "jitsi", "make", "apple-calendar"]) {
      expect(apps[slug]?.enabled, slug).toBe(true);
    }
  });
});
