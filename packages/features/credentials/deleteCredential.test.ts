import { addEventTypesToDb, mockNoTranslations } from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { PrismaAppRepository } from "@calcom/features/apps/repository/PrismaAppRepository";
import { DestinationCalendarRepository } from "@calcom/features/calendars/repositories/DestinationCalendarRepository";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { prisma } from "@calcom/prisma";
import { OAuth2Client } from "googleapis-common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const testUser = {
  email: "test@test.com",
  username: "test-user",
  organizationId: null,
};

const setupCredential = async (credentialInput) => {
  const exampleCredential = {
    id: 123,
    type: "test-credential",
    appId: "test-credential",
    userId: null,
    teamId: null,
  };

  return await CredentialRepository.create({ ...exampleCredential, ...credentialInput });
};

describe("deleteCredential", () => {
  beforeEach(async () => {
    mockNoTranslations();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("individual credentials", () => {
    test("Delete video credential", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;

      const user = await new UserRepository(prisma).create({
        ...testUser,
      });

      await addEventTypesToDb([
        {
          id: 1,
          userId: user.id,
          locations: [{ type: "integrations:zoom" }],
        },
        {
          id: 2,
          userId: user.id,
          locations: [{ type: "integrations:msteams" }],
        },
      ]);

      await PrismaAppRepository.seedApp("zoomvideo");

      await setupCredential({ userId: user.id, type: "zoom_video", appId: "zoom" });

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });
      const eventTypeRepo = new EventTypeRepository(prisma);
      const eventTypeQuery = await eventTypeRepo.findAllByUserId({ userId: user.id });

      // Ensure that the event type with the deleted app was converted back to daily
      const changedEventType = eventTypeQuery.find((eventType) => eventType.id === 1)?.locations;
      expect(changedEventType).toBeDefined();
      expect(changedEventType![0]).toEqual({ type: "integrations:daily" });

      const nonChangedEventType = eventTypeQuery.find((eventType) => eventType.id === 2)?.locations;
      expect(nonChangedEventType).toBeDefined();
      expect(nonChangedEventType![0]).toEqual({ type: "integrations:msteams" });
    });
    test("Delete calendar credential", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;

      const user = await new UserRepository(prisma).create({
        ...testUser,
      });

      const eventTypes = await addEventTypesToDb([
        {
          id: 1,
          userId: testUser.id,
        },
      ]);

      await PrismaAppRepository.seedApp("googlecalendar");

      const credential = await setupCredential({
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
      });

      await DestinationCalendarRepository.create({
        id: 1,
        integration: "google_calendar",
        externalId: "test@google.com",
        primaryId: "test@google.com",
        userId: user.id,
        credentialId: credential.id,
      });

      await DestinationCalendarRepository.create({
        id: 2,
        integration: "google_calendar",
        externalId: "test@google.com",
        primaryId: "test@google.com",
        eventTypeId: eventTypes[0].id,
        credentialId: credential.id,
      });

      const userCalendar = await DestinationCalendarRepository.getByUserId(user.id);
      expect(userCalendar).toBeDefined();

      const eventTypeCalendar = await DestinationCalendarRepository.getByEventTypeId(eventTypes[0].id);
      expect(eventTypeCalendar).toBeDefined();

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });

      const userCalendarAfter = await DestinationCalendarRepository.getByUserId(user.id);
      expect(userCalendarAfter).toBeNull();

      const eventTypeCalendarAfter = await DestinationCalendarRepository.getByEventTypeId(eventTypes[0].id);
      expect(eventTypeCalendarAfter).toBeNull();
    });
    test("Delete Google Calendar credential revokes the refresh token at Google", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);

      const user = await new UserRepository(prisma).create({
        ...testUser,
      });

      await PrismaAppRepository.seedApp("googlecalendar");

      await setupCredential({
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: { access_token: "test-access-token", refresh_token: "test-refresh-token" },
      });

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });

      expect(revokeTokenSpy).toHaveBeenCalledTimes(1);
      expect(revokeTokenSpy).toHaveBeenCalledWith("test-refresh-token");
      expect(await prisma.credential.findUnique({ where: { id: 123 } })).toBeNull();
    });
    test("Delete Google Calendar credential even when revoking at Google fails", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      // Like gaxios, the error carries the request URL, which holds the token
      const revokeError = Object.assign(new Error("invalid_token"), {
        config: { url: "https://oauth2.googleapis.com/revoke?token=test-access-token" },
        response: { status: 400 },
      });
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockRejectedValue(revokeError);
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const user = await new UserRepository(prisma).create({
        ...testUser,
      });

      await PrismaAppRepository.seedApp("googlecalendar");

      await setupCredential({
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: { access_token: "test-access-token", refresh_token: null },
      });

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });

      expect(revokeTokenSpy).toHaveBeenCalledWith("test-access-token");
      expect(await prisma.credential.findUnique({ where: { id: 123 } })).toBeNull();
      const revokeWarnings = consoleWarnSpy.mock.calls.filter(([message]) =>
        String(message).includes("revoking Google Calendar token")
      );
      expect(revokeWarnings).toEqual([[expect.any(String), { status: 400, code: undefined }]]);
      expect(JSON.stringify(revokeWarnings)).not.toContain("test-access-token");
    });
    test("Delete Google Calendar credential without revoking a grant another credential shares", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);

      const user = await new UserRepository(prisma).create({
        ...testUser,
      });

      await PrismaAppRepository.seedApp("googlecalendar");

      await setupCredential({
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: { access_token: "old-access-token", refresh_token: "old-refresh-token" },
      });
      // Reconnecting the same Google account adds a second credential and keeps the first
      await setupCredential({
        id: 124,
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: { access_token: "new-access-token", refresh_token: "new-refresh-token" },
      });

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });

      expect(revokeTokenSpy).not.toHaveBeenCalled();
      expect(await prisma.credential.findUnique({ where: { id: 123 } })).toBeNull();
      expect(await prisma.credential.findUnique({ where: { id: 124 } })).not.toBeNull();
    });

    // TODO: Add test for payment apps
    // TODO: Add test for event type apps
  });
});
