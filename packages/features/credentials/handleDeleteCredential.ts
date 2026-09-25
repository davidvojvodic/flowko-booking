import { OAuth2Client } from "googleapis-common";
import z from "zod";

import { findDisabledApps } from "@calcom/app-store/_utils/findDisabledApps";
import { getCalendar } from "@calcom/app-store/_utils/getCalendar";
import { appStoreMetadata } from "@calcom/app-store/appStoreMetaData";
import { lookUpGoogleAccount } from "@calcom/app-store/googlecalendar/lib/lookUpGoogleAccount";
import { DailyLocationType } from "@calcom/app-store/locations";
import {
  type EventTypeAppMetadataSchema,
  eventTypeAppMetadataOptionalSchema,
} from "@calcom/app-store/zod-utils";
import { eventTypeMetaDataSchemaWithTypedApps } from "@calcom/app-store/zod-utils";
import { sendCancelledEmailsAndSMS } from "@calcom/emails/email-manager";
import { getCalEventResponses } from "@calcom/features/bookings/lib/getCalEventResponses";
import { deletePayment } from "@calcom/features/bookings/lib/payment/deletePayment";
import {
  decryptCredentialKeyResult,
  isTransientCredentialKeyFailure,
  tryDecryptCredentialKey,
} from "@calcom/features/credentials/services/CredentialDataService";
import { deleteWebhookScheduledTriggers } from "@calcom/features/webhooks/lib/scheduleTrigger";
import { buildNonDelegationCredential } from "@calcom/lib/delegationCredential";
import { HttpError } from "@calcom/lib/http-error";
import { isPrismaObjOrUndefined } from "@calcom/lib/isPrismaObj";
import { parseRecurringEvent } from "@calcom/lib/isRecurringEvent";
import { getTranslation } from "@calcom/i18n/server";
import { bookingMinimalSelect, prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { AppCategories, BookingStatus } from "@calcom/prisma/enums";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";
import type { EventTypeMetadata } from "@calcom/prisma/zod-utils";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import { userMetadata as userMetadataSchema } from "@calcom/prisma/zod-utils";
import type { IntegrationCalendar } from "@calcom/types/Calendar";

type App = {
  slug: string;
  categories: AppCategories[];
  dirName: string;
} | null;

const isVideoOrConferencingApp = (app: App) =>
  app?.categories.includes(AppCategories.video) || app?.categories.includes(AppCategories.conferencing);

const getRemovedIntegrationNameFromAppSlug = (slug: string) =>
  slug === "msteams" ? "office365_video" : slug.split("-")[0];

const locationsSchema = z.array(z.object({ type: z.string() }));
type TlocationsSchema = z.infer<typeof locationsSchema>;

const googleCalendarTokenSchema = z.object({
  access_token: z.string().nullish(),
  refresh_token: z.string().nullish(),
});

const GOOGLE_TOKEN_REVOKE_TIMEOUT_MS = 5000;

// Best effort: disconnecting must never be blocked by Google being slow or the grant already being revoked
// credentialId only labels the log line; it is null for a token that was never stored
export const revokeGoogleCalendarToken = async (credentialId: number | null, key: unknown) => {
  const parsedKey = googleCalendarTokenSchema.safeParse(key);
  // The stored access token has usually expired; the long-lived refresh token is what must stop working
  const token = parsedKey.success ? parsedKey.data.refresh_token || parsedKey.data.access_token : undefined;
  if (!token) return;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      new OAuth2Client().revokeToken(token),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), GOOGLE_TOKEN_REVOKE_TIMEOUT_MS);
      }),
    ]);
    if (result === "timeout") {
      console.warn(`Timed out revoking Google Calendar token for credentialId: ${credentialId}`);
    }
  } catch (error) {
    // Never log the error itself: revokeToken sends the token in the request URL, which errors can echo back
    const { response, code } = (error ?? {}) as { response?: { status?: number }; code?: unknown };
    console.warn(`Error revoking Google Calendar token for credentialId: ${credentialId}`, {
      status: response?.status,
      code,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

// Revoking ends Google's grant for the whole Google account, not just this credential's token,
// so any other connection to that account would silently stop syncing.
// credentialIds are the credentials going away with the revoke: the one disconnected, none for a token
// that was never stored, or every credential of a user whose account is deleted.
export const isGoogleGrantSharedWithAnotherCredential = async ({
  credentialIds,
  userId,
  primaryCalendarId,
}: {
  credentialIds: number[];
  userId: number;
  primaryCalendarId?: string;
}) => {
  // The user's other credential may be for the same Google account, e.g. from a reconnect whose earlier
  // credential the callback could not replace
  const otherCredentialOfUser = await prisma.credential.findFirst({
    where: { userId, type: "google_calendar", id: { notIn: credentialIds } },
    select: { id: true },
  });
  if (otherCredentialOfUser) return true;
  if (!primaryCalendarId) return false;

  // Another user connected the same Google account.
  // Flowko: a SelectedCalendar or DestinationCalendar row with this calendar id proves nothing on its own:
  // a calendar shared from this account carries the same id, and another tenant could write such a row.
  // Only another user's google_calendar credential whose token Google says belongs to this account shares
  // the grant. The rows only pick which credentials to ask about. When Google does not answer, the
  // credential does not count and the grant is revoked, which keeps the disconnect's privacy promise.
  const calendarOfAccount = { integration: "google_calendar", externalId: primaryCalendarId };
  const otherUsersCredentials = await prisma.credential.findMany({
    where: {
      type: "google_calendar",
      id: { notIn: credentialIds },
      userId: { not: userId },
      OR: [
        { selectedCalendars: { some: calendarOfAccount } },
        { destinationCalendars: { some: calendarOfAccount } },
      ],
    },
    // Flowko U9: the tokens are encrypted at rest and `key` holds only a placeholder. A key that can't be
    // decrypted is looked up as null, which reads as "unknown": that credential does not count and the grant
    // is revoked
    select: { id: true, type: true, userId: true, teamId: true, encryptedKey: true },
  });
  const accounts = await Promise.all(
    otherUsersCredentials.map((credential) => lookUpGoogleAccount(tryDecryptCredentialKey(credential)))
  );
  return accounts.some(
    (account) => account.status === "found" && account.primaryCalendarId === primaryCalendarId
  );
};

// The callback never stores a token that lacks a required scope. Revoke its grant unless another
// connection may share it. The Google account is only known when calendar.readonly was granted;
// without it, keep the grant.
export const revokeUnstoredGoogleCalendarToken = async ({
  userId,
  key,
}: {
  userId: number;
  key: unknown;
}) => {
  try {
    const account = await lookUpGoogleAccount(key);
    if (account.status !== "found") return;
    const grantShared = await isGoogleGrantSharedWithAnotherCredential({
      credentialIds: [],
      userId,
      primaryCalendarId: account.primaryCalendarId,
    });
    if (grantShared) {
      console.info(`Skipped revoking a shared Google Calendar grant for userId: ${userId}`);
      return;
    }
    await revokeGoogleCalendarToken(null, key);
  } catch (error) {
    console.warn(`Error revoking an unstored Google Calendar token for userId: ${userId}`, {
      error: error instanceof Error ? error.name : "Unknown error",
      code: (error as { code?: unknown } | null)?.code,
    });
  }
};

// Deleting an account cascade-deletes its credentials without telling Google. Revoke each Google
// Calendar grant first, unless another user's connection to the same Google account shares it.
// Best effort, like a disconnect: it never throws, so it can never block the deletion.
export const revokeGoogleCalendarTokensOfUser = async (userId: number) => {
  try {
    const credentials = await prisma.credential.findMany({
      where: { userId, type: "google_calendar" },
      // Flowko U9: the tokens are encrypted at rest; decrypt them from encryptedKey
      select: { id: true, type: true, userId: true, teamId: true, encryptedKey: true },
    });
    // All of them go away with the account, so none of them counts as sharing the grant
    const credentialIds = credentials.map(({ id }) => id);
    await Promise.all(
      credentials.map(async (credential) => {
        const key = tryDecryptCredentialKey(credential);
        // Flowko U9: without the key there is nothing to revoke with. Deleting the account is never blocked
        if (!key) {
          console.error(
            `Google grant NOT revoked for credentialId: ${credential.id}: stored key unavailable`
          );
          return;
        }
        const account = await lookUpGoogleAccount(key);
        // Nothing left to revoke
        if (account.status === "grant_revoked") return;
        const grantShared = await isGoogleGrantSharedWithAnotherCredential({
          credentialIds,
          userId,
          primaryCalendarId: account.status === "found" ? account.primaryCalendarId : undefined,
        });
        if (grantShared) {
          console.info(`Skipped revoking shared Google Calendar grant for credentialId: ${credential.id}`);
          return;
        }
        await revokeGoogleCalendarToken(credential.id, key);
      })
    );
  } catch (error) {
    console.warn(`Error revoking Google Calendar tokens for userId: ${userId}`, {
      error: error instanceof Error ? error.name : "Unknown error",
      code: (error as { code?: unknown } | null)?.code,
    });
  }
};

// Flowko U9: the host sees this as the reason the removal failed, so it is worded in their language
const GOOGLE_CALENDAR_REMOVAL_UNAVAILABLE_MESSAGE =
  "This Google Calendar connection can't be removed right now. Try again later.";

const googleCalendarRemovalUnavailableError = async (userId: number) => {
  let message = GOOGLE_CALENDAR_REMOVAL_UNAVAILABLE_MESSAGE;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    const t = await getTranslation(user?.locale ?? "en", "common");
    message = t("google_calendar_removal_unavailable");
  } catch {
    // The refusal itself must never fail: keep the English message
  }
  // A 4xx, not a 500: tRPC passes it on with its own code (CONFLICT) and this message, so the UI can tell the
  // refusal apart from an unexpected failure
  return new HttpError({ statusCode: 409, message });
};

const handleDeleteCredential = async ({
  userId,
  userMetadata,
  credentialId,
  teamId,
}: {
  userId: number;
  userMetadata?: Prisma.JsonValue;
  credentialId: number;
  teamId?: number;
}) => {
  const credential = await prisma.credential.findFirst({
    where: {
      id: credentialId,
      ...(teamId ? { teamId } : { userId }),
    },
    select: {
      ...credentialForCalendarServiceSelect,
      app: {
        select: {
          slug: true,
          categories: true,
          dirName: true,
        },
      },
    },
  });

  if (!credential) {
    throw new Error("Credential not found");
  }

  // Flowko U9: the Google tokens are encrypted at rest, so decrypt before the first write. While the keyring
  // is unavailable (a transient failure) the disconnect is refused, which keeps the promise to revoke the
  // grant once the key is back. A row that can never be decrypted (no envelope, or a malformed one) is removed
  // without a revoke. A dead token (credential.invalid) still decrypts: its revoke is attempted, best effort
  let googleCalendarKey: Prisma.JsonObject | null = null;
  if (credential.type === "google_calendar") {
    const keyResult = decryptCredentialKeyResult(credential);
    if (keyResult.ok) {
      googleCalendarKey = keyResult.key;
    } else if (isTransientCredentialKeyFailure(keyResult.reason)) {
      console.error(
        `Refused removing Google Calendar credentialId: ${credential.id}: stored key unavailable (${keyResult.reason})`
      );
      throw await googleCalendarRemovalUnavailableError(userId);
    } else {
      console.error(
        `Google grant NOT revoked for credentialId: ${credential.id}: stored key unavailable (${keyResult.reason})`
      );
    }
  }

  const eventTypes = await prisma.eventType.findMany({
    where: {
      OR: [
        {
          ...(teamId ? { teamId } : { userId }),
        },
        // for managed events
        {
          parent: {
            teamId,
          },
        },
      ],
    },
    select: {
      id: true,
      locations: true,
      destinationCalendar: {
        include: {
          credential: true,
        },
      },
      price: true,
      currency: true,
      metadata: true,
    },
  });

  // Flowko: Cal Video replaces a removed video app only while the admin has it switched on (App.enabled).
  // Otherwise the removed app's location is dropped rather than swapped for a disabled app's location.
  const canReplaceWithDailyVideo =
    isVideoOrConferencingApp(credential.app) &&
    !(await findDisabledApps(prisma, { locationTypes: [DailyLocationType] })).locationTypes.length;

  // TODO: Improve this uninstallation cleanup per event by keeping a relation of EventType to App which has the data.
  for (const eventType of eventTypes) {
    // If it's a video, replace the location with Cal video
    if (eventType.locations && isVideoOrConferencingApp(credential.app)) {
      // Find the user's event types

      const integrationQuery = getRemovedIntegrationNameFromAppSlug(credential.app?.slug ?? "");

      // Check if the event type uses the deleted integration

      // To avoid type errors, need to stringify and parse JSON to use array methods
      const locations = locationsSchema.parse(eventType.locations);

      const doesDailyVideoAlreadyExists = locations.some((location) =>
        location.type.includes(DailyLocationType)
      );

      const updatedLocations: TlocationsSchema = locations.reduce((acc: TlocationsSchema, location) => {
        if (location.type.includes(integrationQuery)) {
          if (!doesDailyVideoAlreadyExists && canReplaceWithDailyVideo) acc.push({ type: DailyLocationType });
        } else {
          acc.push(location);
        }
        return acc;
      }, []);

      await prisma.eventType.update({
        where: {
          id: eventType.id,
        },
        data: {
          locations: updatedLocations,
        },
      });
    }

    // If it's a calendar, remove the destination calendar from the event type
    if (
      credential.app?.categories.includes(AppCategories.calendar) &&
      eventType.destinationCalendar?.credential?.appId === credential.appId
    ) {
      const destinationCalendar = await prisma.destinationCalendar.findUnique({
        where: {
          id: eventType.destinationCalendar?.id,
        },
      });

      if (destinationCalendar) {
        await prisma.destinationCalendar.delete({
          where: {
            id: destinationCalendar.id,
          },
        });
      }
    }

    if (credential.app?.categories.includes(AppCategories.crm)) {
      const metadata = EventTypeMetaDataSchema.parse(eventType.metadata);
      const appSlugToDelete = credential.app?.slug;
      const apps = eventTypeAppMetadataOptionalSchema.parse(metadata?.apps);
      if (appSlugToDelete) {
        const appMetadata = removeAppFromEventTypeMetadata(appSlugToDelete, {
          apps,
        });

        await prisma.$transaction(async () => {
          await prisma.eventType.update({
            where: {
              id: eventType.id,
            },
            data: {
              hidden: true,
              metadata: {
                ...metadata,
                apps: {
                  ...appMetadata,
                },
              },
            },
          });
        });
      }
    }

    // If it's a payment, hide the event type and set the price to 0. Also cancel all pending bookings
    if (credential.app?.categories.includes(AppCategories.payment)) {
      const metadata = EventTypeMetaDataSchema.parse(eventType.metadata);
      const appSlug = credential.app?.slug;
      if (appSlug) {
        const apps = eventTypeAppMetadataOptionalSchema.parse(metadata?.apps);
        const appMetadata = removeAppFromEventTypeMetadata(appSlug, {
          apps,
        });

        await prisma.$transaction(async () => {
          await prisma.eventType.update({
            where: {
              id: eventType.id,
            },
            data: {
              hidden: true,
              metadata: {
                ...metadata,
                apps: {
                  ...appMetadata,
                },
              },
            },
          });

          // Only cancel unpaid pending bookings that:
          // 1. Are in the future (startTime > now) - don't cancel old bookings
          // 2. Have failed payments associated with the payment app being deleted
          const unpaidBookings = await prisma.booking.findMany({
            where: {
              userId: userId,
              eventTypeId: eventType.id,
              status: "PENDING",
              paid: false,
              startTime: {
                gt: new Date(),
              },
              payment: {
                some: {
                  appId: credential.appId,
                  success: false,
                },
              },
            },
            select: {
              ...bookingMinimalSelect,
              recurringEventId: true,
              userId: true,
              responses: true,
              user: {
                select: {
                  id: true,
                  credentials: true,
                  email: true,
                  timeZone: true,
                  name: true,
                  destinationCalendar: true,
                  locale: true,
                  profiles: {
                    select: {
                      organizationId: true,
                    },
                  },
                },
              },
              location: true,
              references: {
                select: {
                  uid: true,
                  type: true,
                  externalCalendarId: true,
                },
              },
              payment: true,
              paid: true,
              eventType: {
                select: {
                  recurringEvent: true,
                  title: true,
                  bookingFields: true,
                  seatsPerTimeSlot: true,
                  seatsShowAttendees: true,
                  eventName: true,
                  hideOrganizerEmail: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  metadata: true,
                },
              },
              uid: true,
              eventTypeId: true,
              destinationCalendar: true,
            },
          });

          const unpaidBookingsIds = unpaidBookings.map((booking) => booking.id);
          const unpaidBookingsPaymentIds = unpaidBookings.flatMap((booking) =>
            booking.payment.map((payment) => payment.id)
          );
          await prisma.booking.updateMany({
            where: {
              id: {
                in: unpaidBookingsIds,
              },
            },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: "Payment method removed",
            },
          });
          for (const paymentId of unpaidBookingsPaymentIds) {
            await deletePayment(paymentId, credential);
          }
          await prisma.payment.deleteMany({
            where: {
              id: {
                in: unpaidBookingsPaymentIds,
              },
            },
          });
          await prisma.attendee.deleteMany({
            where: {
              bookingId: {
                in: unpaidBookingsIds,
              },
            },
          });
          await prisma.bookingReference.updateMany({
            where: {
              bookingId: {
                in: unpaidBookingsIds,
              },
            },
            data: { deleted: true },
          });
          for (const booking of unpaidBookings) {
            const attendeesListPromises = booking.attendees.map(async (attendee) => {
              return {
                name: attendee.name,
                email: attendee.email,
                timeZone: attendee.timeZone,
                language: {
                  translate: await getTranslation(attendee.locale ?? "en", "common"),
                  locale: attendee.locale ?? "en",
                },
              };
            });

            const attendeesList = await Promise.all(attendeesListPromises);
            const tOrganizer = await getTranslation(booking?.user?.locale ?? "en", "common");
            await sendCancelledEmailsAndSMS(
              {
                type: booking?.eventType?.title as string,
                title: booking.title,
                description: booking.description,
                customInputs: isPrismaObjOrUndefined(booking.customInputs),
                ...getCalEventResponses({
                  bookingFields: booking.eventType?.bookingFields ?? null,
                  booking,
                }),
                startTime: booking.startTime.toISOString(),
                endTime: booking.endTime.toISOString(),
                organizer: {
                  email: booking?.userPrimaryEmail ?? (booking?.user?.email as string),
                  name: booking?.user?.name ?? "Nameless",
                  timeZone: booking?.user?.timeZone as string,
                  language: { translate: tOrganizer, locale: booking?.user?.locale ?? "en" },
                },
                attendees: attendeesList,
                uid: booking.uid,
                recurringEvent: parseRecurringEvent(booking.eventType?.recurringEvent),
                location: booking.location,
                destinationCalendar: booking.destinationCalendar
                  ? [booking.destinationCalendar]
                  : booking.user?.destinationCalendar
                    ? [booking.user?.destinationCalendar]
                    : [],
                cancellationReason: "Payment method removed by organizer",
                seatsPerTimeSlot: booking.eventType?.seatsPerTimeSlot,
                seatsShowAttendees: booking.eventType?.seatsShowAttendees,
                hideOrganizerEmail: booking.eventType?.hideOrganizerEmail,
                team: booking.eventType?.team
                  ? {
                      name: booking.eventType.team.name,
                      id: booking.eventType.team.id,
                      members: [],
                    }
                  : undefined,
                organizationId: booking.user?.profiles?.[0]?.organizationId ?? null,
              },
              {
                eventName: booking?.eventType?.eventName,
              },
              booking?.eventType?.metadata as EventTypeMetadata
            );
          }
        });
      }
    } else if (
      appStoreMetadata[credential.app?.slug as keyof typeof appStoreMetadata]?.extendsFeature === "EventType"
    ) {
      const metadata = eventTypeMetaDataSchemaWithTypedApps.parse(eventType.metadata);
      const appSlug = credential.app?.slug;
      if (appSlug) {
        await prisma.eventType.update({
          where: {
            id: eventType.id,
          },
          data: {
            hidden: true,
            metadata: {
              ...metadata,
              apps: {
                ...metadata?.apps,
                [appSlug]: undefined,
              },
            },
          },
        });
      }
    }
  }

  // if zapier or make get disconnected, delete its apiKey, delete its webhooks and cancel all scheduled jobs
  if (credential.app?.slug === "zapier" || credential.app?.slug === "make") {
    const ownerFilter = teamId ? { teamId } : { userId };
    await prisma.apiKey.deleteMany({
      where: {
        ...ownerFilter,
        appId: credential.app.slug,
      },
    });
    await prisma.webhook.deleteMany({
      where: {
        ...ownerFilter,
        appId: credential.app.slug,
      },
    });

    deleteWebhookScheduledTriggers({
      appId: credential.appId,
      userId: teamId ? undefined : userId,
      teamId,
    });
  }

  let metadata = userMetadataSchema.parse(userMetadata);

  if (credential.app?.slug === metadata?.defaultConferencingApp?.appSlug) {
    metadata = {
      ...metadata,
      defaultConferencingApp: undefined,
    };
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        metadata,
      },
    });
  }

  let calendars: IntegrationCalendar[] | undefined;

  // Backwards compatibility. Selected calendars cascade on delete when deleting a credential
  // If it's a calendar remove it from the SelectedCalendars
  if (credential.app?.categories.includes(AppCategories.calendar)) {
    try {
      const calendar = await getCalendar(buildNonDelegationCredential(credential), "slots");

      calendars = await calendar?.listCalendars();

      const calendarIds = calendars?.map((cal) => cal.externalId);

      await prisma.selectedCalendar.deleteMany({
        where: {
          userId: userId,
          integration: credential.type as string,
          externalId: {
            in: calendarIds,
          },
        },
      });
    } catch (error) {
      console.warn(
        `Error deleting selected calendars for userId: ${userId} integration: ${credential.type}`,
        error
      );
    }
  }

  // Flowko U9: no key means a permanent key failure, logged above: there is nothing to revoke with
  if (credential.type === "google_calendar" && googleCalendarKey) {
    const grantShared = await isGoogleGrantSharedWithAnotherCredential({
      credentialIds: [credential.id],
      userId,
      // The primary calendar id is the Google account's email address
      primaryCalendarId: calendars?.find((cal) => cal.primary)?.externalId,
    });
    if (grantShared) {
      console.info(`Skipped revoking shared Google Calendar grant for credentialId: ${credential.id}`);
    } else {
      await revokeGoogleCalendarToken(credential.id, googleCalendarKey);
    }
  }

  // Validated that credential is user's above
  await prisma.credential.delete({
    where: {
      id: credentialId,
    },
  });
};

const removeAppFromEventTypeMetadata = (
  appSlugToDelete: string,
  eventTypeMetadata: {
    apps: z.infer<typeof eventTypeAppMetadataOptionalSchema>;
  }
) => {
  const appMetadata = eventTypeMetadata?.apps
    ? Object.entries(eventTypeMetadata.apps).reduce(
        (filteredApps, [appName, appData]) => {
          if (appName !== appSlugToDelete) {
            (filteredApps as Record<string, unknown>)[appName] = appData;
          }
          return filteredApps;
        },
        {} as z.infer<typeof EventTypeAppMetadataSchema>
      )
    : {};

  return appMetadata;
};

export default handleDeleteCredential;
