import { addEventTypesToDb, mockNoTranslations } from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { PrismaAppRepository } from "@calcom/features/apps/repository/PrismaAppRepository";
import { DestinationCalendarRepository } from "@calcom/features/calendars/repositories/DestinationCalendarRepository";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { prisma } from "@calcom/prisma";
import { lookUpGoogleAccount } from "@calcom/app-store/googlecalendar/lib/lookUpGoogleAccount";
import { OAuth2Client } from "googleapis-common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@calcom/app-store/googlecalendar/lib/lookUpGoogleAccount", () => ({ lookUpGoogleAccount: vi.fn() }));
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

  describe("revoking Google Calendar grants the app does not keep", () => {
    const googleKey = (name: string) => ({ access_token: `${name}-access`, refresh_token: `${name}-refresh` });

    const setupUserWithGoogleCredentials = async (
      userInput: { email: string; username: string },
      credentials: { id: number; name: string }[]
    ) => {
      const user = await new UserRepository(prisma).create({ ...testUser, ...userInput });
      for (const { id, name } of credentials) {
        await setupCredential({
          id,
          userId: user.id,
          type: "google_calendar",
          appId: "google-calendar",
          key: googleKey(name),
        });
      }
      return user;
    };

    const mockPrimaryCalendars = (primaryCalendarIdByToken: Record<string, string | "revoked">) => {
      vi.mocked(lookUpGoogleAccount).mockImplementation(async (key) => {
        const primaryCalendarId = primaryCalendarIdByToken[(key as { refresh_token: string }).refresh_token];
        if (!primaryCalendarId) return { status: "unknown" };
        if (primaryCalendarId === "revoked") return { status: "grant_revoked" };
        return { status: "found", primaryCalendarId };
      });
    };

    test("Deleting an account revokes the grant of each Google Calendar credential", async () => {
      const { revokeGoogleCalendarTokensOfUser } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, [
        { id: 123, name: "work" },
        { id: 124, name: "personal" },
      ]);
      mockPrimaryCalendars({ "work-refresh": "owner@work.si", "personal-refresh": "owner@gmail.com" });

      await revokeGoogleCalendarTokensOfUser(user.id);

      expect(revokeTokenSpy).toHaveBeenCalledTimes(2);
      expect(revokeTokenSpy).toHaveBeenCalledWith("work-refresh");
      expect(revokeTokenSpy).toHaveBeenCalledWith("personal-refresh");
    });

    test("Deleting an account keeps a grant another user's connection shares", async () => {
      const { revokeGoogleCalendarTokensOfUser } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, [{ id: 123, name: "shared" }]);
      const otherUser = await setupUserWithGoogleCredentials(
        { email: "colleague@test.com", username: "colleague" },
        [{ id: 124, name: "colleague" }]
      );
      await prisma.selectedCalendar.create({
        data: {
          userId: otherUser.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 124,
        },
      });
      mockPrimaryCalendars({ "shared-refresh": "salon@gmail.com" });

      await revokeGoogleCalendarTokensOfUser(user.id);

      expect(revokeTokenSpy).not.toHaveBeenCalled();
    });

    test("Deleting an account does not revoke a grant Google already revoked, and never throws", async () => {
      const { revokeGoogleCalendarTokensOfUser } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, [{ id: 123, name: "dead" }]);
      mockPrimaryCalendars({ "dead-refresh": "revoked" });

      await revokeGoogleCalendarTokensOfUser(user.id);
      expect(revokeTokenSpy).not.toHaveBeenCalled();

      vi.mocked(lookUpGoogleAccount).mockRejectedValue(new Error("unexpected"));
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await expect(revokeGoogleCalendarTokensOfUser(user.id)).resolves.toBeUndefined();
    });

    test("A token with a missing scope is revoked when no other connection shares its grant", async () => {
      const { revokeUnstoredGoogleCalendarToken } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, []);
      mockPrimaryCalendars({ "partial-refresh": "owner@gmail.com" });

      await revokeUnstoredGoogleCalendarToken({ userId: user.id, key: googleKey("partial") });

      expect(revokeTokenSpy).toHaveBeenCalledWith("partial-refresh");
    });

    test("A token with a missing scope is kept when the account is unknown or already connected", async () => {
      const { revokeUnstoredGoogleCalendarToken } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, []);

      // Without calendar.readonly Google does not say which account the token belongs to
      mockPrimaryCalendars({});
      await revokeUnstoredGoogleCalendarToken({ userId: user.id, key: googleKey("partial") });

      // The user already has a working connection, which may be the same Google account
      await setupCredential({
        id: 125,
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: googleKey("existing"),
      });
      mockPrimaryCalendars({ "partial-refresh": "owner@gmail.com" });
      await revokeUnstoredGoogleCalendarToken({ userId: user.id, key: googleKey("partial") });

      expect(revokeTokenSpy).not.toHaveBeenCalled();
    });
  });
});
