import { findDisabledApps } from "@calcom/app-store/_utils/findDisabledApps";
import { ErrorCode } from "@calcom/lib/errorCodes";
import type { PrismaClient } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";

type EventTypeAppsData = {
  /** The event type's metadata, whose `apps` holds each app's settings */
  metadata?: unknown;
  locations?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTurnedOnAppKeys(metadata: unknown): string[] {
  if (!isRecord(metadata) || !isRecord(metadata.apps)) return [];
  const apps = metadata.apps;
  return Object.keys(apps).filter((appKey) => {
    const app = apps[appKey];
    return isRecord(app) && app.enabled === true;
  });
}

function getLocationTypes(locations: unknown): string[] {
  if (!Array.isArray(locations)) return [];
  return locations.flatMap((location) =>
    isRecord(location) && typeof location.type === "string" ? [location.type] : []
  );
}

/**
 * Flowko: an app switched off under Settings → Admin → Apps (App.enabled = false) stays off for event types,
 * whatever a request sends. An event type write may not turn on a disabled app in metadata.apps (an
 * analytics tag, for instance) or add a location of a disabled app (Google Meet, Cal Video, ...).
 * What the event type already had before the write (`current`) stays allowed, so its owner can still save
 * it; the public booking page leaves a disabled app out anyway.
 */
export async function ensureAppsEnabled(
  prisma: Pick<PrismaClient, "app">,
  { metadata, locations }: EventTypeAppsData,
  current?: EventTypeAppsData
) {
  const currentAppKeys = new Set(getTurnedOnAppKeys(current?.metadata));
  const currentLocationTypes = new Set(getLocationTypes(current?.locations));

  const disabled = await findDisabledApps(prisma, {
    appKeys: getTurnedOnAppKeys(metadata).filter((appKey) => !currentAppKeys.has(appKey)),
    locationTypes: getLocationTypes(locations).filter((type) => !currentLocationTypes.has(type)),
  });
  if (disabled.appKeys.length || disabled.locationTypes.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });
  }
}
