import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "../__mocks__/features.repository";
import "../__mocks__/getGoogleAppKeys";
import { calendarListMock, calendarMock, setCredentialsMock } from "../__mocks__/googleapis";

import { OAuth2Client } from "googleapis-common";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "vitest-fetch-mock";

import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import {
  buildCredentialCreateData,
  CredentialKeyUnavailableError,
} from "@calcom/features/credentials/services/CredentialDataService";
import { buildNonDelegationCredential } from "@calcom/lib/delegationCredential";
import { getTestEmails, resetTestEmails } from "@calcom/lib/testEmails";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";
import {
  decryptTestCredentialKey,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";

import { CalendarAuth } from "../CalendarAuth";
import BuildCalendarService from "../CalendarService";

/**
 * Flowko U9 (holistic review NB-4): the Google token crosses several units on its way from the OAuth callback
 * to a Google API call, and every other test mocks at least one side of each hand-off. This file runs the real
 * crypto, the real repository and the real CalendarAuth across them, with only Google itself mocked:
 * (a) the callback's create -> the select every loader uses -> CalendarAuth decrypts, refreshes and writes back;
 * (b) a second instance on the same credential object uses the envelope the first one left there;
 * (c) the select EventManager re-fetches a credential with carries what CalendarAuth decrypts from;
 * (d) without the keyring a fresh instance fails closed and leaves the row, and its validity, untouched.
 */

const FIXED_NOW = new Date("2026-09-25T10:00:00.000Z").getTime();
// CalendarAuth's MyGoogleOAuth2Client sets this; the fake client below applies it like google-auth-library
const EAGER_REFRESH_THRESHOLD_MS = 60_000;
const KEY_PLACEHOLDER = { _enc: "keyring-v1" };

// What the callback stores: a token that expires before the next use, so the first instance must refresh
const STORED_TOKEN = {
  access_token: "SEAM_STORED_ACCESS_TOKEN",
  refresh_token: "SEAM_ORIGINAL_REFRESH_TOKEN",
  scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
  token_type: "Bearer",
  expiry_date: FIXED_NOW - 60_000,
};

// What Google's token endpoint answers: a new access token and no refresh_token (Google does not resend it)
const REFRESHED_TOKEN = {
  access_token: "SEAM_REFRESHED_ACCESS_TOKEN",
  scope: STORED_TOKEN.scope,
  token_type: "Bearer",
  expiry_date: FIXED_NOW + 3_600_000,
};

const ALL_TOKEN_STRINGS = [
  STORED_TOKEN.access_token,
  STORED_TOKEN.refresh_token,
  REFRESHED_TOKEN.access_token,
];

const GOOGLE_CALENDAR = {
  id: "host@example.com",
  summary: "Host",
  primary: true,
  accessRole: "owner",
};

const EXPECTED_CALENDARS = [
  {
    externalId: "host@example.com",
    integration: "google_calendar",
    name: "Host",
    primary: true,
    readOnly: false,
    email: "host@example.com",
  },
];

type TokenEndpoint = (refreshToken: string | null | undefined) => Promise<unknown>;

type FakeOAuth2Client = {
  credentials: Record<string, unknown>;
  setCredentials: Mock<(credentials: Record<string, unknown>) => void>;
  isTokenExpiring: Mock<() => boolean>;
  refreshToken: Mock<TokenEndpoint>;
};

// Google's token endpoint: every client's refreshToken() goes through this one mock, so its call count is the
// number of refreshes across all instances
const tokenEndpoint = vi.fn<TokenEndpoint>();
let createdClients: FakeOAuth2Client[] = [];

/**
 * A stateful stand-in for google-auth-library's OAuth2Client: it keeps what setCredentials got and answers
 * isTokenExpiring from that token's expiry_date, as the real client does. (The shared googleapis mock always
 * says "expiring", which would hide whether a second instance saw the refreshed token.)
 */
function installStatefulOAuth2Client() {
  vi.mocked(OAuth2Client).mockImplementation(function (...args: unknown[]) {
    const options = args[0] as { eagerRefreshThresholdMillis?: number } | undefined;
    const threshold = options?.eagerRefreshThresholdMillis ?? 5 * 60 * 1000;
    const client: FakeOAuth2Client = {
      credentials: {},
      setCredentials: vi.fn<(credentials: Record<string, unknown>) => void>((credentials) => {
        client.credentials = credentials;
        setCredentialsMock(credentials);
      }),
      isTokenExpiring: vi.fn<() => boolean>(() => {
        const expiryDate = client.credentials.expiry_date;
        return typeof expiryDate === "number" ? expiryDate <= Date.now() + threshold : false;
      }),
      refreshToken: vi.fn<TokenEndpoint>((refreshToken) => tokenEndpoint(refreshToken)),
    };
    createdClients.push(client);
    return client as unknown as OAuth2Client;
  });
}

/** The row the Google OAuth callback stores, built with the same real helpers (callback.ts). */
async function storeConnectedCredential() {
  const user = await prismock.user.create({ data: { email: "host@example.com" } });
  await prismock.app.create({ data: { slug: "google-calendar", dirName: "googlecalendar" } });
  const created = await CredentialRepository.create(
    buildCredentialCreateData({
      userId: user.id,
      key: STORED_TOKEN,
      appId: "google-calendar",
      type: "google_calendar",
    })
  );
  return { user, created };
}

/** Loads the row the way the booking and availability paths do: credentialForCalendarServiceSelect. */
async function loadCredentialForCalendarService(id: number): Promise<CredentialForCalendarServiceWithEmail> {
  const row = await prismock.credential.findUniqueOrThrow({
    where: { id },
    select: credentialForCalendarServiceSelect,
  });
  return buildNonDelegationCredential(row);
}

async function readRow(id: number) {
  return prismock.credential.findUniqueOrThrow({ where: { id } });
}

function expectNoTokenIn(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const token of ALL_TOKEN_STRINGS) {
    expect(serialized).not.toContain(token);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date is faked: timers stay real, so nothing waits on a frozen clock
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  stubTestCredentialKeyring();
  createdClients = [];
  installStatefulOAuth2Client();
  tokenEndpoint.mockResolvedValue({ res: { data: REFRESHED_TOKEN, status: 200, statusText: "OK" } });
  calendarListMock.mockResolvedValue({ data: { items: [GOOGLE_CALENDAR] } });
  resetTestEmails();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Google token encryption across the unit seams (Flowko U9)", () => {
  test("(a) a created row decrypts in CalendarAuth, refreshes once and is written back encrypted", async () => {
    const { user, created } = await storeConnectedCredential();

    // The callback builds its CalendarService from this return value: placeholder key, envelope, no token
    expect(created).toMatchObject({ userId: user.id, type: "google_calendar", teamId: null });
    expect(created.key).toEqual(KEY_PLACEHOLDER);
    expect(typeof created.encryptedKey).toBe("string");
    expectNoTokenIn(created);
    expect(decryptTestCredentialKey(await readRow(created.id))).toEqual(STORED_TOKEN);

    const credential = await loadCredentialForCalendarService(created.id);
    const envelopeBefore = credential.encryptedKey;

    await expect(BuildCalendarService(credential).listCalendars()).resolves.toEqual(EXPECTED_CALENDARS);

    // Instance A got the decrypted stored token, found it expiring and refreshed with the ORIGINAL refresh token
    expect(createdClients).toHaveLength(1);
    expect(OAuth2Client).toHaveBeenCalledWith(
      expect.objectContaining({ eagerRefreshThresholdMillis: EAGER_REFRESH_THRESHOLD_MS })
    );
    const [clientA] = createdClients;
    expect(clientA.setCredentials.mock.calls[0][0]).toMatchObject({
      access_token: STORED_TOKEN.access_token,
      refresh_token: STORED_TOKEN.refresh_token,
    });
    expect(clientA.setCredentials.mock.calls[0][0]).not.toHaveProperty("_enc");
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    expect(tokenEndpoint).toHaveBeenCalledWith(STORED_TOKEN.refresh_token);
    expect(calendarMock.calendar_v3.Calendar).toHaveBeenCalledWith({ auth: clientA });

    // The write-back: key is exactly the placeholder, no token anywhere in the row, the envelope is new and
    // holds the NEW access token with the ORIGINAL refresh token Google did not resend
    const row = await readRow(created.id);
    expect(row.key).toEqual(KEY_PLACEHOLDER);
    expect(JSON.stringify(row)).not.toMatch(/access_token|refresh_token/);
    expectNoTokenIn(row);
    expect(row.encryptedKey).not.toBe(envelopeBefore);
    expect(decryptTestCredentialKey(row)).toMatchObject({
      access_token: REFRESHED_TOKEN.access_token,
      refresh_token: STORED_TOKEN.refresh_token,
      expiry_date: REFRESHED_TOKEN.expiry_date,
    });
    expect(row.invalid).toBe(false);

    // The shared credential object carries only the new ciphertext, never the plaintext
    expect(credential.key).toEqual(KEY_PLACEHOLDER);
    expect(credential.encryptedKey).toBe(row.encryptedKey);
    expectNoTokenIn(credential);
  });

  test("(b) a second instance on the same credential object uses the new envelope without refreshing again", async () => {
    const { created } = await storeConnectedCredential();
    const credential = await loadCredentialForCalendarService(created.id);

    await expect(BuildCalendarService(credential).listCalendars()).resolves.toEqual(EXPECTED_CALENDARS);
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    const rowAfterA = await readRow(created.id);

    // Instance B: built from the SAME object A used (as EventManager and getCalendarsEvents reuse one list)
    await expect(BuildCalendarService(credential).listCalendars()).resolves.toEqual(EXPECTED_CALENDARS);

    expect(createdClients).toHaveLength(2);
    const clientB = createdClients[1];
    // B decrypted the envelope A left on the object: the new access token, the kept refresh token
    expect(clientB.setCredentials).toHaveBeenCalledTimes(1);
    expect(clientB.setCredentials.mock.calls[0][0]).toMatchObject({
      access_token: REFRESHED_TOKEN.access_token,
      refresh_token: STORED_TOKEN.refresh_token,
      expiry_date: REFRESHED_TOKEN.expiry_date,
    });
    expect(clientB.refreshToken).not.toHaveBeenCalled();
    // The token endpoint was called once across both instances, and B wrote nothing
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    expect(await readRow(created.id)).toEqual(rowAfterA);
    expect(calendarListMock).toHaveBeenCalledTimes(2);
  });

  test("(c) the credential EventManager re-fetches from the DB carries what CalendarAuth decrypts from", async () => {
    const { user, created } = await storeConnectedCredential();
    const stored = await readRow(created.id);

    // EventManager.createAllCalendarEvents / updateAllCalendarEvents reload a credential that is not in their
    // list with this repository call
    const fetched = await CredentialRepository.findCredentialForCalendarServiceById({ id: created.id });
    if (!fetched) throw new Error("credential not found");

    // The fields decryptCredentialKey reads (the envelope and the AAD it is bound to), as stored
    expect(fetched).toMatchObject({
      id: created.id,
      type: "google_calendar",
      userId: user.id,
      teamId: null,
      encryptedKey: stored.encryptedKey,
      key: KEY_PLACEHOLDER,
      appId: "google-calendar",
    });
    expectNoTokenIn(fetched);

    const client = await new CalendarAuth(fetched).getClient();

    expect(client).toBeDefined();
    expect(createdClients).toHaveLength(1);
    const [authClient] = createdClients;
    expect(authClient.setCredentials.mock.calls[0][0]).toMatchObject({
      access_token: STORED_TOKEN.access_token,
      refresh_token: STORED_TOKEN.refresh_token,
    });
    expect(calendarMock.calendar_v3.Calendar).toHaveBeenCalledWith({ auth: authClient });
    // The re-fetched object's id, type, userId and teamId also drove the write-back of the refreshed token
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    const row = await readRow(created.id);
    expect(row.key).toEqual(KEY_PLACEHOLDER);
    expect(decryptTestCredentialKey(row)).toMatchObject({
      access_token: REFRESHED_TOKEN.access_token,
      refresh_token: STORED_TOKEN.refresh_token,
    });
    expect(fetched.encryptedKey).toBe(row.encryptedKey);
  });

  test("(d) without the keyring a fresh instance fails closed: no Google call, row unchanged, never invalid", async () => {
    const { created } = await storeConnectedCredential();
    const credential = await loadCredentialForCalendarService(created.id);
    const rowBefore = await readRow(created.id);

    stubMissingCredentialKeyring();
    const error = await BuildCalendarService(credential)
      .listCalendars()
      .then(
        () => null,
        (e: unknown) => e
      );

    expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
    expect(error).toMatchObject({
      reason: "keyring_not_configured",
      credentialId: created.id,
      credentialType: "google_calendar",
    });
    // It failed before any OAuth client, refresh or Google API call
    expect(createdClients).toHaveLength(0);
    expect(tokenEndpoint).not.toHaveBeenCalled();
    expect(calendarListMock).not.toHaveBeenCalled();

    // A key failure never marks the credential invalid and never sends the broken-connection e-mail
    const rowAfter = await readRow(created.id);
    expect(rowAfter).toEqual(rowBefore);
    expect(rowAfter.invalid).toBe(false);
    expect(getTestEmails() ?? []).toHaveLength(0);

    // The object still holds the placeholder and the untouched envelope, which decrypts once the keyring is back
    expect(credential.key).toEqual(KEY_PLACEHOLDER);
    expect(credential.encryptedKey).toBe(rowBefore.encryptedKey);
    expect(decryptTestCredentialKey(rowAfter)).toEqual(STORED_TOKEN);
  });
});
