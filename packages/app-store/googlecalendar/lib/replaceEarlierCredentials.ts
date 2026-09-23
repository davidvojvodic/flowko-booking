import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

import { lookUpGoogleAccount } from "./lookUpGoogleAccount";

const log = logger.getSubLogger({ prefix: ["app-store/googlecalendar/lib/replaceEarlierCredentials"] });

export type EarlierGoogleCalendarCredential = {
  id: number;
  key: Prisma.JsonValue;
  /** A SelectedCalendar or DestinationCalendar of it has the new connection's primary calendar id */
  usesPrimaryCalendar: boolean;
};

/**
 * Flowko: the callback adds a credential on every connect and kept the earlier ones, so reconnecting the same
 * Google account left the old refresh token in the database, and disconnecting skipped the revoke because the
 * grant looked shared. This lists the user's other google_calendar credentials. Call it before the callback
 * upserts the primary calendar's SelectedCalendar, which moves that row to the new credential.
 */
export const findEarlierGoogleCalendarCredentials = async ({
  userId,
  credentialId,
  primaryCalendarId,
}: {
  userId: number;
  credentialId: number;
  primaryCalendarId: string;
}): Promise<EarlierGoogleCalendarCredential[]> => {
  try {
    const credentials = await prisma.credential.findMany({
      where: { userId, type: "google_calendar", delegationCredentialId: null, id: { not: credentialId } },
      select: { id: true, key: true },
    });
    if (!credentials.length) return [];

    const where = {
      integration: "google_calendar",
      externalId: primaryCalendarId,
      credentialId: { in: credentials.map(({ id }) => id) },
    };
    const [selectedCalendars, destinationCalendars] = await Promise.all([
      prisma.selectedCalendar.findMany({ where, select: { credentialId: true } }),
      prisma.destinationCalendar.findMany({ where, select: { credentialId: true } }),
    ]);
    const credentialIdsUsingPrimaryCalendar = new Set(
      [...selectedCalendars, ...destinationCalendars].map((calendar) => calendar.credentialId)
    );

    return credentials.map((credential) => ({
      ...credential,
      usesPrimaryCalendar: credentialIdsUsingPrimaryCalendar.has(credential.id),
    }));
  } catch (error) {
    log.warn("Could not look up earlier Google Calendar credentials", {
      userId,
      credentialId,
      error: error instanceof Error ? error.name : "Unknown error",
    });
    return [];
  }
};

/**
 * Deletes the user's earlier credentials for the same Google account as the new credential, without
 * revoking them: they share the new credential's grant. Never touches another user's credentials or
 * another account's.
 *
 * An earlier credential is the same account when Google returns the same primary calendar for its
 * token. A calendar shared from another account can carry the same id as this primary calendar, so a
 * matching SelectedCalendar or DestinationCalendar alone is not enough. It only decides for a
 * credential whose grant is revoked (a revoke at myaccount.google.com, or an expired token), which is
 * the usual reason to reconnect.
 *
 * Its selected and destination calendars and booking references move to the new credential first:
 * deleting it would otherwise cascade-delete the calendars the user chose and unlink the booking
 * references. Best effort: it never throws, so the connection itself always succeeds.
 */
export const replaceEarlierGoogleCalendarCredentials = async ({
  userId,
  credentialId,
  primaryCalendarId,
  earlierCredentials,
}: {
  userId: number;
  credentialId: number;
  primaryCalendarId: string;
  earlierCredentials: EarlierGoogleCalendarCredential[];
}) => {
  if (!earlierCredentials.length) return;

  try {
    const lookups = await Promise.all(
      earlierCredentials.map(async (credential) => ({
        credential,
        account: await lookUpGoogleAccount(credential.key),
      }))
    );
    const sameAccountCredentialIds = lookups
      .filter(({ credential, account }) =>
        account.status === "found"
          ? account.primaryCalendarId === primaryCalendarId
          : account.status === "grant_revoked" && credential.usesPrimaryCalendar
      )
      .map(({ credential }) => credential.id);
    if (!sameAccountCredentialIds.length) return;

    const replaced = { credentialId: { in: sameAccountCredentialIds } };
    await prisma.$transaction([
      prisma.selectedCalendar.updateMany({ where: replaced, data: { credentialId } }),
      prisma.destinationCalendar.updateMany({ where: replaced, data: { credentialId } }),
      prisma.bookingReference.updateMany({ where: replaced, data: { credentialId } }),
      prisma.credential.deleteMany({
        where: { id: { in: sameAccountCredentialIds }, userId, type: "google_calendar" },
      }),
    ]);
    log.info("Replaced earlier Google Calendar credentials of the same account", {
      userId,
      credentialId,
      replacedCredentialIds: sameAccountCredentialIds,
    });
  } catch (error) {
    log.warn("Could not replace earlier Google Calendar credentials", {
      userId,
      credentialId,
      error: error instanceof Error ? error.name : "Unknown error",
    });
  }
};
