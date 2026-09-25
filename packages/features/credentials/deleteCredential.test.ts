import { addEventTypesToDb, mockNoTranslations } from "@calcom/testing/lib/bookingScenario/bookingScenario";
import i18nMock from "@calcom/testing/lib/__mocks__/libServerI18n";
import {
  encryptedTestCredentialFields,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import { PrismaAppRepository } from "@calcom/features/apps/repository/PrismaAppRepository";
import { DestinationCalendarRepository } from "@calcom/features/calendars/repositories/DestinationCalendarRepository";
import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import { encryptedKeyPlaceholder } from "@calcom/features/credentials/services/CredentialDataService";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { HttpError } from "@calcom/lib/http-error";
import { prisma } from "@calcom/prisma";
import { CalendarServiceMap } from "@calcom/app-store/calendar.services.generated";
import { lookUpGoogleAccount } from "@calcom/app-store/googlecalendar/lib/lookUpGoogleAccount";
import type { TFunction } from "i18next";
import { OAuth2Client } from "googleapis-common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@calcom/app-store/googlecalendar/lib/lookUpGoogleAccount", () => ({ lookUpGoogleAccount: vi.fn() }));

// bookingScenario mocks every calendar service with one shared vi.fn per app, which builds nothing unless a
// test gives it an implementation, so no test here calls Google
const googleCalendarServiceMock = async () => vi.mocked((await CalendarServiceMap.googlecalendar).default);

const testUser = {
  email: "test@test.com",
  username: "test-user",
  organizationId: null,
};

const seedDailyVideoApp = ({ enabled }: { enabled: boolean }) =>
  prisma.app.create({
    data: { slug: "daily-video", dirName: "dailyvideo", categories: ["conferencing"], enabled },
  });

const setupCredential = async (credentialInput) => {
  const exampleCredential = {
    id: 123,
    type: "test-credential",
    appId: "test-credential",
    userId: null,
    teamId: null,
  };

  const credential = { ...exampleCredential, ...credentialInput };
  // Flowko U9: a Google Calendar row holds its tokens encrypted, as the callback stores them. A test that
  // passes encryptedKey itself sets up a legacy or broken row
  if (credential.type === "google_calendar" && !("encryptedKey" in credentialInput)) {
    Object.assign(
      credential,
      encryptedTestCredentialFields({
        type: credential.type,
        userId: credential.userId,
        teamId: credential.teamId,
        key: credential.key ?? {},
      })
    );
  }
  return await CredentialRepository.create(credential);
};

describe("deleteCredential", () => {
  beforeEach(async () => {
    mockNoTranslations();
    stubTestCredentialKeyring();
    (await googleCalendarServiceMock()).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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
      await seedDailyVideoApp({ enabled: true });

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
    test("Delete video credential drops the location while Cal Video is switched off", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;

      const user = await new UserRepository(prisma).create({
        ...testUser,
      });

      await addEventTypesToDb([
        {
          id: 1,
          userId: user.id,
          locations: [{ type: "integrations:zoom" }, { type: "inPerson" }],
        },
      ]);

      await PrismaAppRepository.seedApp("zoomvideo");
      await seedDailyVideoApp({ enabled: false });

      await setupCredential({ userId: user.id, type: "zoom_video", appId: "zoom" });

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });
      const eventTypeQuery = await new EventTypeRepository(prisma).findAllByUserId({ userId: user.id });

      expect(eventTypeQuery.find((eventType) => eventType.id === 1)?.locations).toEqual([
        { type: "inPerson" },
      ]);
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
      // Flowko U9: the row holds only the placeholder; the token is revoked from the decrypted envelope
      expect((await prisma.credential.findUnique({ where: { id: 123 } }))?.key).toEqual(
        encryptedKeyPlaceholder()
      );

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
        // Like lookUpGoogleAccount, a missing key (one that could not be decrypted) reads as unknown
        const refreshToken = (key as { refresh_token?: string } | null)?.refresh_token;
        const primaryCalendarId = refreshToken ? primaryCalendarIdByToken[refreshToken] : undefined;
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
      // The colleague connected the same Google account
      mockPrimaryCalendars({ "shared-refresh": "salon@gmail.com", "colleague-refresh": "salon@gmail.com" });

      await revokeGoogleCalendarTokensOfUser(user.id);

      expect(revokeTokenSpy).not.toHaveBeenCalled();
    });

    test("Deleting an account revokes a grant when another user only sees a calendar shared from it", async () => {
      const { revokeGoogleCalendarTokensOfUser } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, [{ id: 123, name: "salon" }]);
      const otherUser = await setupUserWithGoogleCredentials(
        { email: "colleague@test.com", username: "colleague" },
        [{ id: 124, name: "colleague" }]
      );
      // The salon shared its primary calendar with the colleague's own Google account
      await prisma.selectedCalendar.create({
        data: {
          userId: otherUser.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 124,
        },
      });
      mockPrimaryCalendars({
        "salon-refresh": "salon@gmail.com",
        "colleague-refresh": "colleague@gmail.com",
      });

      await revokeGoogleCalendarTokensOfUser(user.id);

      expect(revokeTokenSpy).toHaveBeenCalledTimes(1);
      expect(revokeTokenSpy).toHaveBeenCalledWith("salon-refresh");
    });

    test("A row another tenant wrote with the account's calendar id does not keep the grant", async () => {
      const { isGoogleGrantSharedWithAnotherCredential } = await import("./handleDeleteCredential");
      const user = await setupUserWithGoogleCredentials(testUser, [{ id: 123, name: "salon" }]);
      const attacker = await setupUserWithGoogleCredentials(
        { email: "attacker@test.com", username: "attacker" },
        [{ id: 124, name: "attacker" }]
      );
      const bystander = await new UserRepository(prisma).create({
        ...testUser,
        email: "bystander@test.com",
        username: "bystander",
      });
      // Rows naming the salon's address: under the attacker's own credential, under no credential,
      // and a destination calendar on a credential Google no longer answers for
      await prisma.selectedCalendar.create({
        data: {
          userId: attacker.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 124,
        },
      });
      await prisma.selectedCalendar.create({
        data: { userId: bystander.id, integration: "google_calendar", externalId: "salon@gmail.com" },
      });
      await setupCredential({
        id: 125,
        userId: bystander.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: googleKey("bystander"),
      });
      await prisma.destinationCalendar.create({
        data: {
          userId: bystander.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 125,
        },
      });
      mockPrimaryCalendars({
        "salon-refresh": "salon@gmail.com",
        "attacker-refresh": "attacker@gmail.com",
        "bystander-refresh": "revoked",
      });

      await expect(
        isGoogleGrantSharedWithAnotherCredential({
          credentialIds: [123],
          userId: user.id,
          primaryCalendarId: "salon@gmail.com",
        })
      ).resolves.toBe(false);

      // Once Google says the bystander's credential is the same account, it shares the grant
      mockPrimaryCalendars({ "bystander-refresh": "salon@gmail.com" });
      await expect(
        isGoogleGrantSharedWithAnotherCredential({
          credentialIds: [123],
          userId: user.id,
          primaryCalendarId: "salon@gmail.com",
        })
      ).resolves.toBe(true);
    });

    test("Another user's credential counts as sharing the grant only when Google confirms the account", async () => {
      const { revokeGoogleCalendarTokensOfUser } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const user = await setupUserWithGoogleCredentials(testUser, [{ id: 123, name: "salon" }]);
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
      // Google does not answer for the colleague's token, so the grant is revoked
      mockPrimaryCalendars({ "salon-refresh": "salon@gmail.com" });

      await revokeGoogleCalendarTokensOfUser(user.id);

      expect(revokeTokenSpy).toHaveBeenCalledWith("salon-refresh");
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

  describe("Google Calendar tokens encrypted at rest", () => {
    const REFUSAL_EN = "This Google Calendar connection can't be removed right now. Try again later.";
    const googleKey = (name: string) => ({
      access_token: `${name}-access`,
      refresh_token: `${name}-refresh`,
    });

    /** A host with a Google Calendar connection that a removal would otherwise change in several places */
    const setupHostWithGoogleCalendar = async (credentialInput: Record<string, unknown> = {}) => {
      const user = await new UserRepository(prisma).create({
        ...testUser,
        locale: "sl",
        metadata: { defaultConferencingApp: { appSlug: "google-calendar" } },
      });
      await PrismaAppRepository.seedApp("googlecalendar");
      const eventTypes = await addEventTypesToDb([{ id: 1, userId: user.id }]);
      await setupCredential({
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: googleKey("salon"),
        ...credentialInput,
      });
      await DestinationCalendarRepository.create({
        id: 2,
        integration: "google_calendar",
        externalId: "salon@gmail.com",
        primaryId: "salon@gmail.com",
        eventTypeId: eventTypes[0].id,
        credentialId: 123,
      });
      await prisma.selectedCalendar.create({
        data: {
          userId: user.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 123,
        },
      });
      return user;
    };

    const snapshotHost = async (userId: number) => ({
      credential: await prisma.credential.findUnique({ where: { id: 123 } }),
      eventType: await prisma.eventType.findUnique({ where: { id: 1 } }),
      destinationCalendar: await prisma.destinationCalendar.findUnique({ where: { id: 2 } }),
      selectedCalendars: await prisma.selectedCalendar.findMany({ where: { credentialId: 123 } }),
      user: await prisma.user.findUnique({ where: { id: userId }, select: { metadata: true } }),
    });

    test.each([
      ["the keyring is not configured", {}, () => stubMissingCredentialKeyring()],
      [
        "the envelope does not decrypt (bound to another user)",
        {
          key: encryptedKeyPlaceholder(),
          encryptedKey: encryptedTestCredentialFields({
            type: "google_calendar",
            userId: 999,
            key: googleKey("salon"),
          }).encryptedKey,
        },
        () => undefined,
      ],
    ])("A removal is refused before any write while the stored key is unavailable: %s", async (_label, credentialInput, breakKey) => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.mocked(lookUpGoogleAccount).mockReset();
      const user = await setupHostWithGoogleCalendar(credentialInput);
      const before = await snapshotHost(user.id);
      breakKey();

      const removal = handleDeleteCredential({
        userId: user.id,
        userMetadata: user.metadata,
        credentialId: 123,
      });

      await expect(removal).rejects.toBeInstanceOf(HttpError);
      await expect(removal).rejects.toMatchObject({
        statusCode: 409,
        message: "google_calendar_removal_unavailable",
      });
      expect(await snapshotHost(user.id)).toEqual(before);
      expect(before.credential).not.toBeNull();
      expect(before.eventType).not.toBeNull();
      expect(before.destinationCalendar).not.toBeNull();
      expect(before.selectedCalendars).toHaveLength(1);
      expect(revokeTokenSpy).not.toHaveBeenCalled();
      expect(await googleCalendarServiceMock()).not.toHaveBeenCalled();
      expect(lookUpGoogleAccount).not.toHaveBeenCalled();
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).toContain("credentialId: 123");
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("salon-");
    });

    test("The refusal is worded in the host's language, and in English if the translation can't load", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const user = await setupHostWithGoogleCalendar();
      stubMissingCredentialKeyring();

      i18nMock.getTranslation.mockImplementation(
        async (locale: string) => ((key: string) => `${locale}:${key}`) as unknown as TFunction
      );
      await expect(
        handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 })
      ).rejects.toMatchObject({ statusCode: 409, message: "sl:google_calendar_removal_unavailable" });

      i18nMock.getTranslation.mockRejectedValue(new Error("locale bundle missing"));
      await expect(
        handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 })
      ).rejects.toMatchObject({ statusCode: 409, message: REFUSAL_EN });
      expect(await prisma.credential.findUnique({ where: { id: 123 } })).not.toBeNull();
    });

    test("The refusal text exists in English and Slovenian", () => {
      expect(en.google_calendar_removal_unavailable).toBe(REFUSAL_EN);
      expect(sl.google_calendar_removal_unavailable).toBe(
        "Te povezave z Google Calendar trenutno ni mogoče odstraniti. Poskusite znova pozneje."
      );
    });

    test.each([
      ["no envelope (a legacy plaintext row)", { encryptedKey: null }, "not_encrypted"],
      ["a malformed envelope", { encryptedKey: '{"v":1}' }, "malformed_envelope"],
    ])("A row whose key can never be decrypted is removed without a revoke: %s", async (_label, credentialInput, reason) => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      // A legacy row: the plaintext token sits in key and must never be used as a fallback
      const user = await setupHostWithGoogleCalendar(credentialInput);

      await expect(
        handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 })
      ).resolves.toBeUndefined();

      expect(await prisma.credential.findUnique({ where: { id: 123 } })).toBeNull();
      expect(revokeTokenSpy).not.toHaveBeenCalled();
      const grantLogs = consoleErrorSpy.mock.calls.filter(([message]) =>
        String(message).includes("Google grant NOT revoked")
      );
      expect(grantLogs).toEqual([[expect.stringContaining(`credentialId: 123`)]]);
      expect(String(grantLogs[0][0])).toContain(reason);
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("salon-");
    });

    test("A dead token (invalid credential) is still removed, and its revoke is attempted", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      const revokeTokenSpy = vi
        .spyOn(OAuth2Client.prototype, "revokeToken")
        .mockRejectedValue(Object.assign(new Error("invalid_token"), { response: { status: 400 } }));
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      // Google refuses the dead grant
      (await googleCalendarServiceMock()).mockImplementation(
        () =>
          ({
            listCalendars: async () => {
              throw new Error("invalid_grant");
            },
          }) as never
      );
      const user = await setupHostWithGoogleCalendar({ invalid: true });

      await expect(
        handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 })
      ).resolves.toBeUndefined();

      expect(revokeTokenSpy).toHaveBeenCalledWith("salon-refresh");
      expect(await prisma.credential.findUnique({ where: { id: 123 } })).toBeNull();
    });

    test("The grant-sharing check looks up other users' decrypted tokens, never the placeholder", async () => {
      const handleDeleteCredential = (await import("./handleDeleteCredential")).default;
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      // The primary calendar id is the Google account's email address
      (await googleCalendarServiceMock()).mockImplementation(
        () =>
          ({
            listCalendars: async () => [
              { externalId: "salon@gmail.com", primary: true, integration: "google_calendar" },
            ],
          }) as never
      );
      const user = await setupHostWithGoogleCalendar();
      const colleague = await new UserRepository(prisma).create({
        ...testUser,
        email: "colleague@test.com",
        username: "colleague",
      });
      await setupCredential({
        id: 124,
        userId: colleague.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: googleKey("colleague"),
      });
      await prisma.selectedCalendar.create({
        data: {
          userId: colleague.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 124,
        },
      });
      // The colleague connected the same Google account
      vi.mocked(lookUpGoogleAccount).mockReset();
      vi.mocked(lookUpGoogleAccount).mockImplementation(async (key) =>
        (key as { refresh_token?: string } | null)?.refresh_token === "colleague-refresh"
          ? { status: "found", primaryCalendarId: "salon@gmail.com" }
          : { status: "unknown" }
      );

      await handleDeleteCredential({ userId: user.id, userMetadata: user.metadata, credentialId: 123 });

      expect(lookUpGoogleAccount).toHaveBeenCalledWith(googleKey("colleague"));
      expect(vi.mocked(lookUpGoogleAccount).mock.calls).not.toContainEqual([encryptedKeyPlaceholder()]);
      expect(revokeTokenSpy).not.toHaveBeenCalled();
      expect(await prisma.credential.findUnique({ where: { id: 123 } })).toBeNull();
    });

    test("Another user's credential whose key can't be decrypted does not keep the grant", async () => {
      const { isGoogleGrantSharedWithAnotherCredential } = await import("./handleDeleteCredential");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const user = await setupHostWithGoogleCalendar();
      const colleague = await new UserRepository(prisma).create({
        ...testUser,
        email: "colleague@test.com",
        username: "colleague",
      });
      // Its envelope was copied from another tenant's row, so it fails authentication
      await setupCredential({
        id: 124,
        userId: colleague.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: encryptedKeyPlaceholder(),
        encryptedKey: encryptedTestCredentialFields({
          type: "google_calendar",
          userId: user.id,
          key: googleKey("colleague"),
        }).encryptedKey,
      });
      await prisma.selectedCalendar.create({
        data: {
          userId: colleague.id,
          integration: "google_calendar",
          externalId: "salon@gmail.com",
          credentialId: 124,
        },
      });
      vi.mocked(lookUpGoogleAccount).mockReset();
      vi.mocked(lookUpGoogleAccount).mockImplementation(async (key) =>
        key ? { status: "found", primaryCalendarId: "salon@gmail.com" } : { status: "unknown" }
      );

      await expect(
        isGoogleGrantSharedWithAnotherCredential({
          credentialIds: [123],
          userId: user.id,
          primaryCalendarId: "salon@gmail.com",
        })
      ).resolves.toBe(false);
      expect(lookUpGoogleAccount).toHaveBeenCalledWith(null);
    });

    test("Deleting an account skips a credential whose key can't be decrypted, logs it and never throws", async () => {
      const { revokeGoogleCalendarTokensOfUser } = await import("./handleDeleteCredential");
      const revokeTokenSpy = vi.spyOn(OAuth2Client.prototype, "revokeToken").mockResolvedValue(undefined);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const user = await new UserRepository(prisma).create({ ...testUser });
      await setupCredential({
        id: 123,
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: googleKey("work"),
      });
      // A legacy row: its plaintext key must not be revoked from, or looked up
      await setupCredential({
        id: 124,
        userId: user.id,
        type: "google_calendar",
        appId: "google-calendar",
        key: googleKey("legacy"),
        encryptedKey: null,
      });
      vi.mocked(lookUpGoogleAccount).mockReset();
      vi.mocked(lookUpGoogleAccount).mockResolvedValue({
        status: "found",
        primaryCalendarId: "owner@work.si",
      });

      await expect(revokeGoogleCalendarTokensOfUser(user.id)).resolves.toBeUndefined();

      expect(revokeTokenSpy).toHaveBeenCalledTimes(1);
      expect(revokeTokenSpy).toHaveBeenCalledWith("work-refresh");
      expect(lookUpGoogleAccount).toHaveBeenCalledTimes(1);
      expect(lookUpGoogleAccount).toHaveBeenCalledWith(googleKey("work"));
      expect(consoleErrorSpy.mock.calls).toContainEqual([
        "Google grant NOT revoked for credentialId: 124: stored key unavailable",
      ]);

      // With the keyring gone, nothing is revoked and the deletion still goes ahead
      revokeTokenSpy.mockClear();
      stubMissingCredentialKeyring();
      await expect(revokeGoogleCalendarTokensOfUser(user.id)).resolves.toBeUndefined();
      expect(revokeTokenSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls).toContainEqual([
        "Google grant NOT revoked for credentialId: 123: stored key unavailable",
      ]);
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toMatch(/work-|legacy-/);
    });
  });
});
