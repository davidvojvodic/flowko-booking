import type { PrismaClient } from "@calcom/prisma";

import { getAppSlugFromLocationType } from "../locations";

type PrismaLike = Pick<PrismaClient, "app">;

// An event type's metadata.apps is keyed by the app's directory name, except stripepayment's "stripe"
const getDirNameFromAppKey = (appKey: string) => (appKey === "stripe" ? "stripepayment" : appKey);

/**
 * Flowko: an app switched off under Settings → Admin → Apps (App.enabled = false) stays off server-side.
 * Returns the app keys (keys of an event type's metadata.apps) and location types among the given ones
 * whose app has no enabled App row. A location type that belongs to no app (in person, a link, a phone
 * number, the organizer's default app) is never disabled.
 */
export async function findDisabledApps(
  prisma: PrismaLike,
  { appKeys = [], locationTypes = [] }: { appKeys?: string[]; locationTypes?: string[] }
): Promise<{ appKeys: string[]; locationTypes: string[] }> {
  const appSlugByLocationType = new Map(
    locationTypes.flatMap((type) => {
      const appSlug = getAppSlugFromLocationType(type);
      return appSlug ? [[type, appSlug] as const] : [];
    })
  );
  if (!appKeys.length && !appSlugByLocationType.size) return { appKeys: [], locationTypes: [] };

  const enabledApps = await prisma.app.findMany({
    where: {
      enabled: true,
      OR: [
        { dirName: { in: appKeys.map(getDirNameFromAppKey) } },
        { slug: { in: [...appSlugByLocationType.values()] } },
      ],
    },
    select: { slug: true, dirName: true },
  });
  const enabledDirNames = new Set(enabledApps.map((app) => app.dirName));
  const enabledSlugs = new Set(enabledApps.map((app) => app.slug));

  return {
    appKeys: appKeys.filter((appKey) => !enabledDirNames.has(getDirNameFromAppKey(appKey))),
    locationTypes: [...appSlugByLocationType]
      .filter(([, appSlug]) => !enabledSlugs.has(appSlug))
      .map(([type]) => type),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Flowko: the booking pages render an app's tag (analytics scripts, a pixel) and use its settings from the
 * event type's metadata.apps. The metadata sent to them leaves out every app the admin switched off,
 * whatever the event type still holds, and giphy's legacy thank-you page with a disabled giphy.
 */
export async function withoutDisabledApps<TMetadata>(
  prisma: PrismaLike,
  metadata: TMetadata
): Promise<TMetadata> {
  if (!isRecord(metadata)) return metadata;
  const apps = isRecord(metadata.apps) ? metadata.apps : {};
  const appKeys = Object.keys(apps);
  if (metadata.giphyThankYouPage && !appKeys.includes("giphy")) appKeys.push("giphy");

  const disabled = await findDisabledApps(prisma, { appKeys });
  if (!disabled.appKeys.length) return metadata;

  const filteredMetadata: Record<string, unknown> = {
    ...metadata,
    apps: Object.fromEntries(Object.entries(apps).filter(([appKey]) => !disabled.appKeys.includes(appKey))),
  };
  if (disabled.appKeys.includes("giphy")) delete filteredMetadata.giphyThankYouPage;
  return filteredMetadata as TMetadata;
}
