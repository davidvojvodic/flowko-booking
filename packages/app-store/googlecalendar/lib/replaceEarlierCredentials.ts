import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import type { IntegrationCalendar } from "@calcom/types/Calendar";

import { lookUpGoogleAccount } from "./lookUpGoogleAccount";

const log = logger.getSubLogger({ prefix: ["app-store/googlecalendar/lib/replaceEarlierCredentials"] });

const LIST_NEW_CONNECTION_CALENDARS_TIMEOUT_MS = 5000;

export type EarlierGoogleCalendarCredential = {
  id: number;
  key: Prisma.JsonValue;
  /** A SelectedCalendar or DestinationCalendar of it has the new connection's primary calendar id */
  usesPrimaryCalendar: boolean;
  /** externalIds of its SelectedCalendar rows, which move to the new credential if it is replaced */
  selectedCalendarIds: string[];
  /** externalIds of its DestinationCalendar rows, which move to the new credential if it is replaced */
  destinationCalendarIds: string[];
};

type NewConnectionCalendar = Pick<IntegrationCalendar, "externalId" | "readOnly">;

/**
 * Flowko: every client business is its own user on this instance. Only the user's own SelectedCalendar
 * rows (filtered by userId) and these DestinationCalendar rows, the user's and their event types', decide
 * or move with a replace. Another tenant could point a row at this user's credential, and such a row must
 * neither veto the replace nor end up on the new credential.
 */
const ownDestinationCalendarsOf = (userId: number) => ({ OR: [{ userId }, { eventType: { userId } }] });

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

    // Every row a replace would move, whatever calendar it points at
    const byCredential = { credentialId: { in: credentials.map(({ id }) => id) } };
    const select = { credentialId: true, externalId: true };
    const [selectedCalendars, destinationCalendars] = await Promise.all([
      prisma.selectedCalendar.findMany({ where: { ...byCredential, userId }, select }),
      prisma.destinationCalendar.findMany({
        where: { ...byCredential, ...ownDestinationCalendarsOf(userId) },
        select,
      }),
    ]);
    const externalIdsOf = (
      calendars: { credentialId: number | null; externalId: string }[],
      credentialId: number
    ) =>
      calendars
        .filter((calendar) => calendar.credentialId === credentialId)
        .map(({ externalId }) => externalId);

    return credentials.map((credential) => {
      const selectedCalendarIds = externalIdsOf(selectedCalendars, credential.id);
      const destinationCalendarIds = externalIdsOf(destinationCalendars, credential.id);
      return {
        ...credential,
        usesPrimaryCalendar: [...selectedCalendarIds, ...destinationCalendarIds].includes(primaryCalendarId),
        selectedCalendarIds,
        destinationCalendarIds,
      };
    });
  } catch (error) {
    log.warn("Could not look up earlier Google Calendar credentials", {
      userId,
      credentialId,
      error: error instanceof Error ? error.name : "Unknown error",
      code: (error as { code?: unknown } | null)?.code,
    });
    return [];
  }
};

/**
 * The new connection's calendars, or none when Google does not answer in time. Best effort: it never throws.
 */
const listNewConnectionCalendars = async (
  listNewConnectionCalendarsFromGoogle: () => Promise<NewConnectionCalendar[]>
): Promise<NewConnectionCalendar[]> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const calendars = await Promise.race([
      listNewConnectionCalendarsFromGoogle(),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), LIST_NEW_CONNECTION_CALENDARS_TIMEOUT_MS);
      }),
    ]);
    return calendars === "timeout" ? [] : calendars;
  } catch (error) {
    log.warn("Could not list the new Google Calendar connection's calendars", {
      error: error instanceof Error ? error.name : "Unknown error",
      code: (error as { code?: unknown } | null)?.code,
    });
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Whether replacing the credential loses nothing: the new connection can read every calendar it had
 * selected and write to every destination calendar it had.
 */
const newConnectionKeepsEveryCalendar = (
  credential: EarlierGoogleCalendarCredential,
  newConnectionCalendars: NewConnectionCalendar[]
) => {
  const readable = new Set(newConnectionCalendars.map(({ externalId }) => externalId));
  const writable = new Set(
    newConnectionCalendars.filter(({ readOnly }) => !readOnly).map(({ externalId }) => externalId)
  );
  return (
    credential.selectedCalendarIds.every((externalId) => readable.has(externalId)) &&
    credential.destinationCalendarIds.every((externalId) => writable.has(externalId))
  );
};

/**
 * Deletes the user's earlier credentials for the same Google account as the new credential, without
 * revoking them: they share the new credential's grant. Never touches another user's credentials or
 * another account's.
 *
 * An earlier credential is the same account when Google returns the same primary calendar for its
 * token. When its grant is revoked (a revoke at myaccount.google.com, or an expired token, which is
 * the usual reason to reconnect), Google can no longer say which account it was. A calendar shared
 * from another account can carry this primary calendar's id, so a matching SelectedCalendar or
 * DestinationCalendar alone does not prove the account. Such a credential is replaced only when it
 * used this primary calendar and the new connection can read every calendar it had selected and
 * write to every destination calendar it had, so replacing it loses nothing whichever account it
 * was. Otherwise it is kept, as upstream does, with its reconnect prompt.
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
  listNewConnectionCalendars: listNewConnectionCalendarsFromGoogle,
}: {
  userId: number;
  credentialId: number;
  primaryCalendarId: string;
  earlierCredentials: EarlierGoogleCalendarCredential[];
  /** The calendars the new credential can see; called only when an earlier credential's grant is revoked */
  listNewConnectionCalendars: () => Promise<NewConnectionCalendar[]>;
}) => {
  if (!earlierCredentials.length) return;

  try {
    const lookups = await Promise.all(
      earlierCredentials.map(async (credential) => ({
        credential,
        account: await lookUpGoogleAccount(credential.key),
      }))
    );
    const isRevokedCandidate = ({ credential, account }: (typeof lookups)[number]) =>
      account.status === "grant_revoked" && credential.usesPrimaryCalendar;
    const newConnectionCalendars = lookups.some(isRevokedCandidate)
      ? await listNewConnectionCalendars(listNewConnectionCalendarsFromGoogle)
      : [];
    const sameAccountCredentialIds = lookups
      .filter((lookup) =>
        lookup.account.status === "found"
          ? lookup.account.primaryCalendarId === primaryCalendarId
          : isRevokedCandidate(lookup) &&
            newConnectionKeepsEveryCalendar(lookup.credential, newConnectionCalendars)
      )
      .map(({ credential }) => credential.id);
    if (!sameAccountCredentialIds.length) return;

    const replaced = { credentialId: { in: sameAccountCredentialIds } };
    await prisma.$transaction([
      prisma.selectedCalendar.updateMany({ where: { ...replaced, userId }, data: { credentialId } }),
      prisma.destinationCalendar.updateMany({
        where: { ...replaced, ...ownDestinationCalendarsOf(userId) },
        data: { credentialId },
      }),
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
      code: (error as { code?: unknown } | null)?.code,
    });
  }
};
