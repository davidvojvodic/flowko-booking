import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@calcom/prisma";

import { findDisabledApps } from "./findDisabledApps";

type AppWhere = {
  enabled: true;
  OR: [{ dirName: { in: string[] } }, { slug: { in: string[] } }];
};

const appRows = [
  { slug: "google-calendar", dirName: "googlecalendar" },
  { slug: "google-meet", dirName: "googlevideo" },
  { slug: "daily-video", dirName: "dailyvideo" },
  { slug: "ga4", dirName: "ga4" },
  { slug: "stripe", dirName: "stripepayment" },
];

// An App table in which only the given apps are enabled; the seed leaves only google-calendar enabled
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

describe("findDisabledApps", () => {
  it("does not query the App table when nothing belongs to an app", async () => {
    const { prisma, findMany } = withEnabledApps("google-calendar");

    await expect(
      findDisabledApps(prisma, { appKeys: [], locationTypes: ["inPerson", "link", "conferencing"] })
    ).resolves.toEqual({ appKeys: [], locationTypes: [] });

    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns the metadata.apps keys whose App row is not enabled", async () => {
    const { prisma } = withEnabledApps("google-calendar");

    await expect(
      findDisabledApps(prisma, { appKeys: ["googlecalendar", "ga4", "stripe", "unknown-app"] })
    ).resolves.toEqual({ appKeys: ["ga4", "stripe", "unknown-app"], locationTypes: [] });
  });

  it("looks the stripe key up by its directory name, stripepayment", async () => {
    const { prisma, findMany } = withEnabledApps("stripe");

    await expect(findDisabledApps(prisma, { appKeys: ["stripe"] })).resolves.toEqual({
      appKeys: [],
      locationTypes: [],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { enabled: true, OR: [{ dirName: { in: ["stripepayment"] } }, { slug: { in: [] } }] },
      select: { slug: true, dirName: true },
    });
  });

  it("returns the location types of apps whose App row is not enabled", async () => {
    const { prisma, findMany } = withEnabledApps("google-calendar");

    await expect(
      findDisabledApps(prisma, {
        locationTypes: ["integrations:google:meet", "integrations:daily", "inPerson"],
      })
    ).resolves.toEqual({ appKeys: [], locationTypes: ["integrations:google:meet", "integrations:daily"] });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        OR: [{ dirName: { in: [] } }, { slug: { in: ["google-meet", "daily-video"] } }],
      },
      select: { slug: true, dirName: true },
    });
  });

  it("allows the location of an enabled app", async () => {
    const { prisma } = withEnabledApps("google-calendar", "google-meet");

    await expect(findDisabledApps(prisma, { locationTypes: ["integrations:google:meet"] })).resolves.toEqual({
      appKeys: [],
      locationTypes: [],
    });
  });
});
