import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "../__mocks__/features.repository";
import "../__mocks__/getGoogleAppKeys";
import {
  setCredentialsMock,
  calendarListMock,
  getLastCreatedJWT,
  getLastCreatedOAuth2Client,
  setLastCreatedJWT,
  setLastCreatedOAuth2Client,
  calendarMock,
  adminMock,
  MOCK_JWT_TOKEN,
  MOCK_OAUTH2_TOKEN,
} from "../__mocks__/googleapis";

import { OAuth2Client } from "googleapis-common";
import { afterEach, expect, test, beforeEach, vi, describe } from "vitest";
import "vitest-fetch-mock";

import { CredentialKeyUnavailableError } from "@calcom/features/credentials/services/CredentialDataService";
import {
  decryptTestCredentialKey,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";

import BuildCalendarService from "../CalendarService";
import {
  createMockJWTInstance,
  createInMemoryDelegationCredentialForCalendarService as createInMemoryDelegationCredentialForBuildCalendarService,
  defaultDelegatedCredential,
  createCredentialForCalendarService,
  googleTestCredentialKey,
} from "./utils";

function expectJWTInstanceToBeCreated() {
  expect(getLastCreatedJWT()).toBeDefined();
  expect(setCredentialsMock).not.toHaveBeenCalled();
}

function expectOAuth2InstanceToBeCreated() {
  expect(setCredentialsMock).toHaveBeenCalled();
  expect(getLastCreatedJWT()).toBeNull();
}

function mockSuccessfulCalendarListFetch() {
  calendarListMock.mockImplementation(() => {
    return {
      data: { items: [] },
    };
  });
}

// Flowko U9: the next OAuth2 client refreshes to `refreshedToken`, running `onRefresh` first
function mockNextOAuth2ClientRefresh({
  refreshedToken,
  onRefresh,
}: {
  refreshedToken: Record<string, unknown>;
  onRefresh?: () => void;
}) {
  vi.mocked(OAuth2Client).mockImplementationOnce(function (...args: unknown[]) {
    const client = {
      type: "oauth2" as const,
      args: args as [string, string, string],
      setCredentials: setCredentialsMock,
      isTokenExpiring: vi.fn().mockReturnValue(true),
      refreshToken: vi.fn().mockImplementation(async () => {
        onRefresh?.();
        return { res: { data: refreshedToken, status: 200, statusText: "OK" } };
      }),
    };
    setLastCreatedOAuth2Client(client as unknown as Parameters<typeof setLastCreatedOAuth2Client>[0]);
    return client as unknown as OAuth2Client;
  });
}

const KEY_PLACEHOLDER = { _enc: "keyring-v1" };

beforeEach(() => {
  vi.clearAllMocks();
  setCredentialsMock.mockClear();
  calendarMock.calendar_v3.Calendar.mockClear();
  adminMock.admin_directory_v1.Admin.mockClear();

  setLastCreatedJWT(null);
  setLastCreatedOAuth2Client(null);
  createMockJWTInstance({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function expectNoCredentialsInDb() {
  const credentials = await prismock.credential.findMany({});
  expect(credentials).toHaveLength(0);
}

async function expectCredentialsInDb(credentials: CredentialForCalendarServiceWithEmail[]) {
  const credentialsInDb = await prismock.credential.findMany({});
  expect(credentialsInDb.length).toBe(credentials.length);
  expect(credentialsInDb).toEqual(expect.arrayContaining(credentials));
}

describe("GoogleCalendarService credential handling", () => {
  describe("Delegation Credential", () => {
    test("uses JWT auth with impersonation when listCalendars is called and creates a new credential in DB with the key as JWT token if it doesn't exist", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      mockSuccessfulCalendarListFetch();
      expectNoCredentialsInDb();
      const calendarService = BuildCalendarService(credentialWithDelegation);
      await calendarService.listCalendars();
      expectJWTInstanceToBeCreated();
      await expectCredentialsInDb([
        expect.objectContaining({
          delegationCredentialId: credentialWithDelegation.delegationCredentialId,
          key: MOCK_JWT_TOKEN,
          userId: credentialWithDelegation.userId,
        }),
      ]);
    });

    test("uses JWT auth with impersonation when listCalendars is called and updates the credential in DB with the new JWT token if it exists", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      mockSuccessfulCalendarListFetch();
      const existingCredential = await prismock.credential.create({
        data: {
          type: "google_calendar",
          delegationCredentialId: credentialWithDelegation.delegationCredentialId,
          userId: credentialWithDelegation.userId,
          key: {
            access_token: "CURRENT_ACCESS_TOKEN",
          },
        },
      });
      const calendarService = BuildCalendarService(credentialWithDelegation);
      await calendarService.listCalendars();
      expectJWTInstanceToBeCreated();
      await expectCredentialsInDb([
        expect.objectContaining({
          id: existingCredential.id,
          delegationCredentialId: credentialWithDelegation.delegationCredentialId,
          key: MOCK_JWT_TOKEN,
          userId: credentialWithDelegation.userId,
        }),
      ]);
    });

    test("JWT token is reused when not expired when listCalendars is called again on a new instance of CalendarService", async () => {
      const jwtTokenThatHasNotExpired = {
        ...MOCK_JWT_TOKEN,
        expiry_date: Date.now() + 1000 * 60 * 60 * 24,
      };
      createMockJWTInstance({
        tokenExpiryDate: jwtTokenThatHasNotExpired.expiry_date,
      });
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      console.log("TESTS: credentialWithDelegation", credentialWithDelegation);

      mockSuccessfulCalendarListFetch();
      await expectNoCredentialsInDb();
      console.log("TESTS: First instance of CalendarService");
      const calendarService1 = BuildCalendarService({
        ...credentialWithDelegation,
      });
      await calendarService1.listCalendars();
      await expectCredentialsInDb([
        expect.objectContaining({
          delegationCredentialId: credentialWithDelegation.delegationCredentialId,
          key: jwtTokenThatHasNotExpired,
          userId: credentialWithDelegation.userId,
        }),
      ]);

      const existingCredential = await prismock.credential.findFirst({
        where: {
          delegationCredentialId: credentialWithDelegation.delegationCredentialId,
          userId: credentialWithDelegation.userId,
        },
      });
      expect(existingCredential).toBeDefined();
      console.log("TESTS: Second instance of CalendarService");
      createMockJWTInstance({
        authorizeError: {
          response: {
            data: {
              error: "I_WOULD_ERROR_IF_YOU_USE_ME",
            },
          },
        },
      });
      const calendarService2 = BuildCalendarService({
        ...credentialWithDelegation,
      });
      await calendarService2.listCalendars();
      await expectCredentialsInDb([
        expect.objectContaining({
          // Same credential should be reused
          id: existingCredential?.id,
          delegationCredentialId: credentialWithDelegation.delegationCredentialId,
          key: jwtTokenThatHasNotExpired,
        }),
      ]);
    });
  });

  describe("Non-Delegation Credential", () => {
    test("uses OAuth2 auth when listCalendars is called", async () => {
      const regularCredential = await createCredentialForCalendarService();
      mockSuccessfulCalendarListFetch();
      const calendarService = BuildCalendarService(regularCredential);
      await calendarService.listCalendars();

      expectOAuth2InstanceToBeCreated();

      expect(calendarMock.calendar_v3.Calendar).toHaveBeenCalledWith({
        auth: getLastCreatedOAuth2Client(),
      });
      // Flowko U9: the refreshed token is stored encrypted; key holds only the placeholder
      await expectCredentialsInDb([
        expect.objectContaining({
          id: regularCredential.id,
          key: KEY_PLACEHOLDER,
        }),
      ]);
      const row = await prismock.credential.findUniqueOrThrow({ where: { id: regularCredential.id } });
      expect(decryptTestCredentialKey(row)).toMatchObject(MOCK_OAUTH2_TOKEN);
    });
  });

  // Flowko U9: Google tokens are encrypted at rest. CalendarAuth decrypts them from encryptedKey, never reads
  // key as a fallback, stores refreshed tokens encrypted and keeps the plaintext off the shared credential
  describe("Encrypted credential key (Flowko U9)", () => {
    test("gives the OAuth2 client the decrypted token", async () => {
      const credential = await createCredentialForCalendarService();
      expect(credential.key).toEqual(KEY_PLACEHOLDER);
      mockSuccessfulCalendarListFetch();

      await BuildCalendarService(credential).listCalendars();

      expect(setCredentialsMock).toHaveBeenCalledTimes(2);
      const [initialCredentials] = setCredentialsMock.mock.calls[0];
      expect(initialCredentials).toMatchObject({
        access_token: googleTestCredentialKey.access_token,
        refresh_token: googleTestCredentialKey.refresh_token,
      });
      expect(initialCredentials).not.toHaveProperty("_enc");
    });

    test("refuses a plaintext key without an envelope: no Google call and no invalidation", async () => {
      const stored = await createCredentialForCalendarService();
      const plaintextRow = await prismock.credential.update({
        where: { id: stored.id },
        data: { key: { ...googleTestCredentialKey, expiry_date: Date.now() - 1000 }, encryptedKey: null },
      });
      const legacyCredential = { ...stored, key: plaintextRow.key, encryptedKey: null };
      mockSuccessfulCalendarListFetch();

      // Construction never decrypts, so it never throws
      const calendarService = BuildCalendarService(legacyCredential);
      const error = await calendarService.listCalendars().then(
        () => null,
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
      expect(error).toMatchObject({
        reason: "not_encrypted",
        credentialId: stored.id,
        credentialType: "google_calendar",
      });
      expect(getLastCreatedOAuth2Client()).toBeNull();
      expect(setCredentialsMock).not.toHaveBeenCalled();
      expect(calendarListMock).not.toHaveBeenCalled();
      expect(await prismock.credential.findUniqueOrThrow({ where: { id: stored.id } })).toEqual(plaintextRow);
    });

    test("stores a refreshed token encrypted, keeping the refresh token Google did not resend", async () => {
      const refreshedToken = {
        access_token: "REFRESHED_ACCESS_TOKEN",
        scope: "https://www.googleapis.com/auth/calendar.events",
        token_type: "Bearer",
        expiry_date: Date.now() + 3_600_000,
      };
      mockNextOAuth2ClientRefresh({ refreshedToken });
      const credential = await createCredentialForCalendarService();
      const envelopeBefore = credential.encryptedKey;
      mockSuccessfulCalendarListFetch();

      await BuildCalendarService(credential).listCalendars();

      const row = await prismock.credential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(row.key).toEqual(KEY_PLACEHOLDER);
      expect(JSON.stringify(row.key)).not.toMatch(/access_token|refresh_token/);
      expect(row.encryptedKey).not.toBe(envelopeBefore);
      expect(decryptTestCredentialKey(row)).toMatchObject({
        access_token: "REFRESHED_ACCESS_TOKEN",
        refresh_token: googleTestCredentialKey.refresh_token,
      });
    });

    test("writes nothing when the keyring is gone by the time a refreshed token is stored", async () => {
      mockNextOAuth2ClientRefresh({
        refreshedToken: { ...MOCK_OAUTH2_TOKEN, expiry_date: Date.now() + 3_600_000 },
        // The stored token was decrypted already; the keyring disappears before the write-back
        onRefresh: () => stubMissingCredentialKeyring(),
      });
      const credential = await createCredentialForCalendarService();
      const rowBefore = await prismock.credential.findUniqueOrThrow({ where: { id: credential.id } });
      mockSuccessfulCalendarListFetch();

      const error = await BuildCalendarService(credential)
        .listCalendars()
        .then(
          () => null,
          (e: unknown) => e
        );

      expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
      expect(error).toMatchObject({ reason: "keyring_not_configured", credentialType: "google_calendar" });
      expect(getLastCreatedOAuth2Client()?.refreshToken).toHaveBeenCalledTimes(1);
      expect(calendarListMock).not.toHaveBeenCalled();
      expect(await prismock.credential.findUniqueOrThrow({ where: { id: credential.id } })).toEqual(rowBefore);
      expect(credential.key).toEqual(KEY_PLACEHOLDER);
      expect(credential.encryptedKey).toBe(rowBefore.encryptedKey);
    });

    test("puts only the new ciphertext on the caller's credential object after a refresh", async () => {
      const credential = await createCredentialForCalendarService();
      const envelopeBefore = credential.encryptedKey;
      mockSuccessfulCalendarListFetch();

      await BuildCalendarService(credential).listCalendars();

      const row = await prismock.credential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(credential.key).toEqual(KEY_PLACEHOLDER);
      expect(credential.encryptedKey).toBe(row.encryptedKey);
      expect(credential.encryptedKey).not.toBe(envelopeBefore);
      const serialized = JSON.stringify(credential);
      for (const token of [
        MOCK_OAUTH2_TOKEN.access_token,
        MOCK_OAUTH2_TOKEN.refresh_token,
        googleTestCredentialKey.access_token,
        googleTestCredentialKey.refresh_token,
      ]) {
        expect(serialized).not.toContain(token);
      }
    });

    test("does not memoise a failed decrypt: the same instance works once the keyring is back", async () => {
      const credential = await createCredentialForCalendarService();
      mockSuccessfulCalendarListFetch();
      const calendarService = BuildCalendarService(credential);

      stubMissingCredentialKeyring();
      await expect(calendarService.listCalendars()).rejects.toMatchObject({
        reason: "keyring_not_configured",
        credentialId: credential.id,
      });
      expect(setCredentialsMock).not.toHaveBeenCalled();

      stubTestCredentialKeyring();
      await expect(calendarService.listCalendars()).resolves.toEqual([]);
      expect(setCredentialsMock).toHaveBeenCalled();
    });
  });

  describe("Delegation Credential Error handling", () => {
    test("handles clientId not added to Google Workspace Admin Console error", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      createMockJWTInstance({
        authorizeError: {
          response: {
            data: {
              error: "unauthorized_client",
            },
          },
        },
      });

      const calendarService = BuildCalendarService(credentialWithDelegation);

      await expect(calendarService.listCalendars()).rejects.toThrow(
        "Make sure that the Client ID for the delegation credential is added to the Google Workspace Admin Console"
      );
    });

    test("handles DelegationCredential authorization errors appropriately", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      createMockJWTInstance({
        authorizeError: {
          response: {
            data: {
              error: "unauthorized_client",
            },
          },
        },
      });

      const calendarService = BuildCalendarService(credentialWithDelegation);

      await expect(calendarService.listCalendars()).rejects.toThrow(
        "Make sure that the Client ID for the delegation credential is added to the Google Workspace Admin Console"
      );
    });

    test("handles invalid_grant error (user not in workspace) appropriately", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      createMockJWTInstance({
        authorizeError: {
          response: {
            data: {
              error: "invalid_grant",
            },
          },
        },
      });

      const calendarService = BuildCalendarService(credentialWithDelegation);

      await expect(calendarService.listCalendars()).rejects.toThrow(
        `User ${credentialWithDelegation.user?.email} might not exist in Google Workspace`
      );
    });

    test("handles DelegationCredential authorization errors appropriately", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: "user@example.com" },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      createMockJWTInstance({
        authorizeError: new Error("Some unexpected error"),
      });

      const calendarService = BuildCalendarService(credentialWithDelegation);

      await expect(calendarService.listCalendars()).rejects.toThrow(
        "Error authorizing delegation credential"
      );
    });

    test("On missing user email for DelegationCredential, it should fallback to OAuth2 auth", async () => {
      const credentialWithDelegation = await createInMemoryDelegationCredentialForBuildCalendarService({
        user: { email: null },
        delegatedTo: defaultDelegatedCredential,
        delegationCredentialId: "delegation-credential-id-1",
      });

      const calendarService = BuildCalendarService(credentialWithDelegation);
      mockSuccessfulCalendarListFetch();
      await calendarService.listCalendars();
      expectOAuth2InstanceToBeCreated();
    });
  });
});
