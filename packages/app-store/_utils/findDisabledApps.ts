import type { PrismaClient } from "@calcom/prisma";

import { getAppSlugFromLocationType } from "../locations";

type PrismaLike = Pick<PrismaClient, "app">;

// An event type's metadata.apps is keyed by the app's directory name, except stripepayment's "stripe"
const getDirNameFromAppKey = (appKey: string) => (appKey === "stripe" ? "stripepayment" : appKey);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Booking treats every location type containing this as a video app's (EventManager.isDedicatedIntegration)
const INTEGRATION_LOCATION_MARKER = "integrations:";

/**
 * Flowko: an app switched off under Settings → Admin → Apps (App.enabled = false) stays off server-side.
 * Returns the app keys (keys of an event type's metadata.apps) and location types among the given ones
 * whose app has no enabled App row. A location type that belongs to no app (in person, the booker's
 * address or phone, a link, a phone number, somewhere else, the organizer's default app "conferencing")
 * is never disabled. An integrations:* type that maps to no app is always disabled: booking hands such a
 * type to Cal Video, so it must not slip past a switched-off Cal Video.
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
  // Flowko: fail closed. An integrations:* type no app claims (a typo, "integrations:dailyx") gets a Cal Video
  // room at booking time, so it counts as a disabled app's location, not as belonging to no app.
  const unmappedIntegrationTypes = Array.from(new Set(locationTypes)).filter(
    (type) => type.includes(INTEGRATION_LOCATION_MARKER) && !appSlugByLocationType.has(type)
  );
  if (!appKeys.length && !appSlugByLocationType.size) {
    return { appKeys: [], locationTypes: unmappedIntegrationTypes };
  }

  const enabledApps = await prisma.app.findMany({
    where: {
      enabled: true,
      OR: [
        { dirName: { in: appKeys.map(getDirNameFromAppKey) } },
        { slug: { in: Array.from(appSlugByLocationType.values()) } },
      ],
    },
    select: { slug: true, dirName: true },
  });
  const enabledDirNames = new Set(enabledApps.map((app) => app.dirName));
  const enabledSlugs = new Set(enabledApps.map((app) => app.slug));

  return {
    appKeys: appKeys.filter((appKey) => !enabledDirNames.has(getDirNameFromAppKey(appKey))),
    locationTypes: Array.from(appSlugByLocationType)
      .filter(([, appSlug]) => !enabledSlugs.has(appSlug))
      .map(([type]) => type)
      .concat(unmappedIntegrationTypes),
  };
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
