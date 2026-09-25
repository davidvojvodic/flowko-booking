import { findDisabledApps } from "@calcom/app-store/_utils/findDisabledApps";
import { getLocationByType } from "@calcom/app-store/locations";
import { ErrorCode } from "@calcom/lib/errorCodes";
import type { PrismaClient } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";

type EventTypeAppsData = {
  /** The event type's metadata, whose `apps` holds each app's settings */
  metadata?: unknown;
  locations?: unknown;
  /** The event type's price column, which getEventTypeAppData reads as legacy stripe data */
  price?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTurnedOnAppKeys(metadata: unknown): string[] {
  if (!isRecord(metadata) || !isRecord(metadata.apps)) return [];
  const apps = metadata.apps;
  return Object.keys(apps).filter((appKey) => {
    const app = apps[appKey];
    // Flowko: truthy, as getEventTypeAppData reads it (metadata.apps is z.record(z.any()), so enabled: 1 is
    // stored as is and turns the app on at booking time)
    return isRecord(app) && !!app.enabled;
  });
}

/**
 * Flowko: app data outside metadata.apps that booking still reads (getEventTypeAppData's legacy data):
 * metadata.giphyThankYouPage turns giphy on and a non-zero price column turns stripe on. Only a value the
 * write sets new or changes counts, so an event type that already holds one can still be saved.
 */
function getLegacyTurnedOnAppKeys({ metadata, price }: EventTypeAppsData, current?: EventTypeAppsData) {
  const appKeys: string[] = [];
  const currentMetadata = current?.metadata;
  const giphyThankYouPage = isRecord(metadata) ? metadata.giphyThankYouPage : undefined;
  const currentGiphyThankYouPage = isRecord(currentMetadata) ? currentMetadata.giphyThankYouPage : undefined;
  if (giphyThankYouPage && giphyThankYouPage !== currentGiphyThankYouPage) appKeys.push("giphy");
  if (typeof price === "number" && price !== 0 && price !== current?.price) appKeys.push("stripe");
  return appKeys;
}

function getLocationTypes(locations: unknown): string[] {
  if (!Array.isArray(locations)) return [];
  return locations.flatMap((location) => {
    if (!isRecord(location) || typeof location.type !== "string") return [];
    // Flowko: booking uses a location's saved value (an address, a link, a phone number) in place of its type
    // (getLocationValueForDB), and that value is free text that can name an app's location type too
    const valueKey = getLocationByType(location.type)?.defaultValueVariable;
    const value = valueKey ? location[valueKey] : undefined;
    return typeof value === "string" && value ? [location.type, value] : [location.type];
  });
}

/**
 * Flowko: an app switched off under Settings → Admin → Apps (App.enabled = false) stays off for event types,
 * whatever a request sends. An event type write may not turn on a disabled app in metadata.apps (an
 * analytics tag, for instance), turn one on through its legacy data (giphy's thank-you page, stripe's price
 * column) or add a location of a disabled app (Google Meet, Cal Video, ...), as its type or as its value.
 * What the event type already had before the write (`current`) stays allowed, so its owner can still save
 * it; the public booking page leaves a disabled app out anyway.
 */
export async function ensureAppsEnabled(
  prisma: Pick<PrismaClient, "app">,
  { metadata, locations, price }: EventTypeAppsData,
  current?: EventTypeAppsData
) {
  const currentAppKeys = new Set(getTurnedOnAppKeys(current?.metadata));
  const currentLocationTypes = new Set(getLocationTypes(current?.locations));
  const turnedOnAppKeys = getTurnedOnAppKeys(metadata).filter((appKey) => !currentAppKeys.has(appKey));
  // Flowko: legacy app data turns an app on as much as metadata.apps does (N2)
  const legacyAppKeys = getLegacyTurnedOnAppKeys({ metadata, price }, current).filter(
    (appKey) => !turnedOnAppKeys.includes(appKey)
  );

  const disabled = await findDisabledApps(prisma, {
    appKeys: turnedOnAppKeys.concat(legacyAppKeys),
    locationTypes: getLocationTypes(locations).filter((type) => !currentLocationTypes.has(type)),
  });
  if (disabled.appKeys.length || disabled.locationTypes.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });
  }
}
