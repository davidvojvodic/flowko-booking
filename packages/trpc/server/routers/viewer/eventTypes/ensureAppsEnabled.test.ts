import { ErrorCode } from "@calcom/lib/errorCodes";
import type { PrismaClient } from "@calcom/prisma";
import { describe, expect, it, vi } from "vitest";

import { ensureAppsEnabled } from "./ensureAppsEnabled";

type AppWhere = {
  enabled: true;
  OR: [{ dirName: { in: string[] } }, { slug: { in: string[] } }];
};

const appRows = [
  { slug: "google-calendar", dirName: "googlecalendar" },
  { slug: "daily-video", dirName: "dailyvideo" },
  { slug: "giphy", dirName: "giphy" },
  { slug: "stripe", dirName: "stripepayment" },
];

// An App table in which only the given apps are enabled
function withEnabledApps(...enabledSlugs: string[]) {
  const findMany = vi.fn(async ({ where }: { where: AppWhere }) =>
    appRows.filter(
      (app) =>
        enabledSlugs.includes(app.slug) &&
        (where.OR[0].dirName.in.includes(app.dirName) || where.OR[1].slug.in.includes(app.slug))
    )
  );
  return { prisma: { app: { findMany } } as unknown as Pick<PrismaClient, "app">, findMany };
}

const GIF = "https://media.giphy.com/media/x/giphy.gif";
const refused = { code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable };

describe("ensureAppsEnabled", () => {
  describe("an app turned on in metadata.apps with a truthy non-boolean enabled", () => {
    // getEventTypeAppData reads any truthy enabled as on, and metadata.apps is z.record(z.any())
    it("is refused while the app is switched off", async () => {
      const { prisma } = withEnabledApps("google-calendar");

      await expect(
        ensureAppsEnabled(prisma, { metadata: { apps: { giphy: { enabled: 1, thankYouPage: GIF } } } })
      ).rejects.toMatchObject(refused);
      await expect(
        ensureAppsEnabled(prisma, { metadata: { apps: { ga4: { enabled: "1", TRACKING_ID: "G-X" } } } })
      ).rejects.toMatchObject(refused);
    });

    it("stays allowed on an event type that already has it", async () => {
      const { prisma } = withEnabledApps("google-calendar");
      const metadata = { apps: { giphy: { enabled: 1, thankYouPage: GIF } } };

      await expect(ensureAppsEnabled(prisma, { metadata }, { metadata })).resolves.toBeUndefined();
    });
  });

  describe("a location whose saved value names a switched-off app (B1)", () => {
    const MEET = "integrations:google:meet";
    const namingMeet = [
      { type: "inPerson", address: MEET },
      { type: "link", link: MEET },
      { type: "userPhone", hostPhoneNumber: MEET },
    ];

    it.each(namingMeet)("is refused, since booking uses the value ($type)", async (location) => {
      const { prisma } = withEnabledApps("google-calendar");

      await expect(ensureAppsEnabled(prisma, { locations: [location] })).rejects.toMatchObject(refused);
    });

    it("is allowed with a plain address, link or phone number", async () => {
      const { prisma } = withEnabledApps("google-calendar");
      const locations = [
        { type: "inPerson", address: "Slovenska 1, Ljubljana" },
        { type: "link", link: "https://example.com/meet" },
        { type: "userPhone", hostPhoneNumber: "+38640123456" },
      ];

      await expect(ensureAppsEnabled(prisma, { locations })).resolves.toBeUndefined();
    });

    it("stays allowed on an event type that already has it", async () => {
      const { prisma } = withEnabledApps("google-calendar");

      await expect(
        ensureAppsEnabled(prisma, { locations: namingMeet }, { locations: namingMeet })
      ).resolves.toBeUndefined();
    });
  });

  describe("an integrations:* location no app claims (B4)", () => {
    it("is refused, since booking would send it to Cal Video", async () => {
      const { prisma } = withEnabledApps("google-calendar");

      await expect(
        ensureAppsEnabled(prisma, { locations: [{ type: "integrations:dailyx" }] })
      ).rejects.toMatchObject(refused);
    });

    it("stays allowed on an event type that already has it", async () => {
      const { prisma } = withEnabledApps("google-calendar");
      const locations = [{ type: "integrations:dailyx" }];

      await expect(ensureAppsEnabled(prisma, { locations }, { locations })).resolves.toBeUndefined();
    });
  });

  describe("giphy's legacy thank-you page (N2)", () => {
    it("is refused as turning on giphy while giphy is switched off", async () => {
      const { prisma, findMany } = withEnabledApps("google-calendar");

      await expect(
        ensureAppsEnabled(prisma, { metadata: { giphyThankYouPage: GIF } }, { metadata: {} })
      ).rejects.toMatchObject(refused);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, OR: [{ dirName: { in: ["giphy"] } }, { slug: { in: [] } }] },
        })
      );
    });

    it("is refused when changed, but an event type that already holds it can still be saved", async () => {
      const { prisma } = withEnabledApps("google-calendar");
      const current = { metadata: { giphyThankYouPage: GIF } };

      await expect(
        ensureAppsEnabled(prisma, { metadata: { giphyThankYouPage: `${GIF}?v=2` } }, current)
      ).rejects.toMatchObject(refused);
      await expect(
        ensureAppsEnabled(prisma, { metadata: { giphyThankYouPage: GIF } }, current)
      ).resolves.toBeUndefined();
      await expect(ensureAppsEnabled(prisma, { metadata: { giphyThankYouPage: "" } }, current)).resolves.toBe(
        undefined
      );
    });

    it("is allowed while giphy is enabled", async () => {
      const { prisma } = withEnabledApps("google-calendar", "giphy");

      await expect(
        ensureAppsEnabled(prisma, { metadata: { giphyThankYouPage: GIF } })
      ).resolves.toBeUndefined();
    });
  });

  describe("stripe's legacy price column (N2)", () => {
    it("is refused as turning on stripe while stripe is switched off", async () => {
      const { prisma, findMany } = withEnabledApps("google-calendar");

      await expect(ensureAppsEnabled(prisma, { price: 5000 }, { price: 0 })).rejects.toMatchObject(refused);
      await expect(ensureAppsEnabled(prisma, { price: 5000 })).rejects.toMatchObject(refused);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, OR: [{ dirName: { in: ["stripepayment"] } }, { slug: { in: [] } }] },
        })
      );
    });

    it("is refused when changed, but an unchanged or zero price is allowed", async () => {
      const { prisma, findMany } = withEnabledApps("google-calendar");

      await expect(ensureAppsEnabled(prisma, { price: 7000 }, { price: 5000 })).rejects.toMatchObject(refused);
      await expect(ensureAppsEnabled(prisma, { price: 5000 }, { price: 5000 })).resolves.toBeUndefined();
      await expect(ensureAppsEnabled(prisma, { price: 0 }, { price: 5000 })).resolves.toBeUndefined();
      await expect(ensureAppsEnabled(prisma, {}, { price: 5000 })).resolves.toBeUndefined();
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it("is allowed while stripe is enabled", async () => {
      const { prisma } = withEnabledApps("google-calendar", "stripe");

      await expect(ensureAppsEnabled(prisma, { price: 5000 })).resolves.toBeUndefined();
    });

    it("asks about stripe once when metadata.apps turns it on too", async () => {
      const { prisma, findMany } = withEnabledApps("google-calendar");

      await expect(
        ensureAppsEnabled(prisma, {
          metadata: { apps: { stripe: { enabled: true, price: 5000, currency: "eur" } } },
          price: 5000,
        })
      ).rejects.toMatchObject(refused);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, OR: [{ dirName: { in: ["stripepayment"] } }, { slug: { in: [] } }] },
        })
      );
    });
  });
});
