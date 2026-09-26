import prismock from "@calcom/testing/lib/__mocks__/prisma";
import {
  encryptedTestCredentialFields,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { GoogleAccountLookup } from "../lookUpGoogleAccount";
import { lookUpGoogleAccount } from "../lookUpGoogleAccount";
import {
  findEarlierGoogleCalendarCredentials,
  replaceEarlierGoogleCalendarCredentials,
} from "../replaceEarlierCredentials";

vi.mock("../lookUpGoogleAccount", () => ({ lookUpGoogleAccount: vi.fn() }));

const OWNER = "owner@example.com";
const WORK = "work@group.calendar.google.com";
const USER_ID = 1;
const OTHER_USER_ID = 2;
const NEW_CREDENTIAL_ID = 20;
const EVENT_TYPE_ID = 30;

const tokenOf = (credentialId: number) => ({
  access_token: `access-${credentialId}`,
  refresh_token: `refresh-${credentialId}`,
});

const mockGoogleAccounts = (accounts: Record<number, GoogleAccountLookup>) => {
  vi.mocked(lookUpGoogleAccount).mockImplementation(async (key) => {
    // Like the real lookup: a key without a token (null when it could not be decrypted) is "unknown"
    const refreshToken = (key as { refresh_token?: unknown } | null)?.refresh_token;
    if (typeof refreshToken !== "string") return { status: "unknown" };
    const credentialId = Number(refreshToken.split("-")[1]);
    return accounts[credentialId] ?? { status: "unknown" };
  });
};

// Flowko U9: stored like production rows, with the token encrypted in encryptedKey and only a placeholder in key
const encryptedFieldsOf = (id: number, userId: number) =>
  encryptedTestCredentialFields({ type: "google_calendar", userId, teamId: null, key: tokenOf(id) });

const createGoogleCredential = (id: number, userId: number) =>
  prismock.credential.create({
    data: { id, type: "google_calendar", appId: "google-calendar", userId, ...encryptedFieldsOf(id, userId) },
  });

const PLACEHOLDER = { _enc: "keyring-v1" };

/**
 * User 1 reconnected owner@example.com (credential 20 is the new one). Credential 10 is their earlier
 * connection of the same account; credential 11 is their personal account, which has owner@example.com
 * shared into it and uses it as the destination of their event type 30. User 2 connected
 * owner@example.com too (credential 12).
 */
const seed = async () => {
  await prismock.user.create({ data: { id: USER_ID, email: "user1@flowko.si", username: "user1" } });
  await prismock.user.create({ data: { id: OTHER_USER_ID, email: "user2@flowko.si", username: "user2" } });
  for (const [id, userId] of [
    [10, USER_ID],
    [11, USER_ID],
    [12, OTHER_USER_ID],
    [NEW_CREDENTIAL_ID, USER_ID],
  ]) {
    await createGoogleCredential(id, userId);
  }
  const selectedCalendars: [string, number, string, number][] = [
    ["primary-of-10", USER_ID, OWNER, 10],
    ["work-of-10", USER_ID, WORK, 10],
    ["primary-of-12", OTHER_USER_ID, OWNER, 12],
  ];
  for (const [id, userId, externalId, credentialId] of selectedCalendars) {
    await prismock.selectedCalendar.create({
      data: { id, userId, integration: "google_calendar", externalId, credentialId },
    });
  }
  await prismock.destinationCalendar.create({
    data: {
      id: 1,
      userId: USER_ID,
      integration: "google_calendar",
      externalId: WORK,
      primaryEmail: OWNER,
      credentialId: 10,
    },
  });
  await prismock.eventType.create({
    data: { id: EVENT_TYPE_ID, userId: USER_ID, title: "Haircut", slug: "haircut", length: 30 },
  });
  await prismock.destinationCalendar.create({
    data: {
      id: 2,
      eventTypeId: EVENT_TYPE_ID,
      integration: "google_calendar",
      externalId: OWNER,
      credentialId: 11,
    },
  });
  await prismock.bookingReference.create({
    data: {
      id: 1,
      type: "google_calendar",
      uid: "google-event-id",
      externalCalendarId: OWNER,
      credentialId: 10,
    },
  });
};

/** What the new connection to owner@example.com sees: its own primary calendar and the work calendar */
const OWNER_CALENDARS = [
  { externalId: OWNER, readOnly: false },
  { externalId: WORK, readOnly: false },
];

const listNewConnectionCalendars = vi.fn();

const findAndReplace = async () => {
  const earlierCredentials = await findEarlierGoogleCalendarCredentials({
    userId: USER_ID,
    credentialId: NEW_CREDENTIAL_ID,
    primaryCalendarId: OWNER,
  });
  await replaceEarlierGoogleCalendarCredentials({
    userId: USER_ID,
    credentialId: NEW_CREDENTIAL_ID,
    primaryCalendarId: OWNER,
    earlierCredentials,
    listNewConnectionCalendars,
  });
  return earlierCredentials;
};

const remainingCredentialIds = async () =>
  (await prismock.credential.findMany({ select: { id: true } })).map(({ id }) => id).sort((a, b) => a - b);

describe("replaceEarlierGoogleCalendarCredentials", () => {
  beforeEach(async () => {
    stubTestCredentialKeyring();
    vi.mocked(lookUpGoogleAccount).mockReset();
    listNewConnectionCalendars.mockReset().mockResolvedValue(OWNER_CALENDARS);
    await seed();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("finds only the user's own other Google Calendar credentials", async () => {
    const earlierCredentials = await findEarlierGoogleCalendarCredentials({
      userId: USER_ID,
      credentialId: NEW_CREDENTIAL_ID,
      primaryCalendarId: OWNER,
    });

    expect(earlierCredentials.map(({ encryptedKey: _encryptedKey, ...credential }) => credential)).toEqual([
      {
        id: 10,
        type: "google_calendar",
        userId: USER_ID,
        teamId: null,
        invalid: false,
        usesPrimaryCalendar: true,
        selectedCalendarIds: [OWNER, WORK],
        destinationCalendarIds: [WORK],
      },
      {
        id: 11,
        type: "google_calendar",
        userId: USER_ID,
        teamId: null,
        invalid: false,
        usesPrimaryCalendar: true,
        selectedCalendarIds: [],
        destinationCalendarIds: [OWNER],
      },
    ]);
    // Flowko U9: only the ciphertext is carried to the replace, never a token
    for (const credential of earlierCredentials) {
      expect(credential).not.toHaveProperty("key");
      expect(credential.encryptedKey).toEqual(expect.any(String));
      expect(credential.encryptedKey).not.toContain("refresh-");
    }
  });

  test("looks up earlier encrypted credentials with their decrypted tokens", async () => {
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    await findAndReplace();

    // Flowko U9: Google gets each earlier credential's own token, never the placeholder in Credential.key
    expect(vi.mocked(lookUpGoogleAccount)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(lookUpGoogleAccount)).toHaveBeenCalledWith(tokenOf(10));
    expect(vi.mocked(lookUpGoogleAccount)).toHaveBeenCalledWith(tokenOf(11));
    expect(vi.mocked(lookUpGoogleAccount)).not.toHaveBeenCalledWith(PLACEHOLDER);
    // The same account's earlier credential is replaced
    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
  });

  test("keeps an earlier credential whose key cannot be decrypted, as if Google did not answer", async () => {
    // Credential 10 is the same account, but its envelope is bound to another user (a row moved or an
    // envelope copied), so it does not decrypt
    await prismock.credential.update({
      where: { id: 10 },
      data: { encryptedKey: encryptedFieldsOf(10, OTHER_USER_ID).encryptedKey },
    });
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    await findAndReplace();

    expect(vi.mocked(lookUpGoogleAccount)).toHaveBeenCalledWith(null);
    expect(vi.mocked(lookUpGoogleAccount)).not.toHaveBeenCalledWith(tokenOf(10));
    expect(await remainingCredentialIds()).toEqual([10, 11, 12, NEW_CREDENTIAL_ID]);
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "work-of-10" } })).toMatchObject({
      credentialId: 10,
    });
  });

  test("never reads a plaintext key stored without an envelope", async () => {
    // A legacy row: the token sits in key and there is no envelope. key is never a fallback
    await prismock.credential.update({ where: { id: 10 }, data: { key: tokenOf(10), encryptedKey: null } });
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    await findAndReplace();

    expect(vi.mocked(lookUpGoogleAccount)).not.toHaveBeenCalledWith(tokenOf(10));
    expect(await remainingCredentialIds()).toEqual([10, 11, 12, NEW_CREDENTIAL_ID]);
  });

  test("keeps every earlier credential when the keyring is missing", async () => {
    const earlierCredentials = await findEarlierGoogleCalendarCredentials({
      userId: USER_ID,
      credentialId: NEW_CREDENTIAL_ID,
      primaryCalendarId: OWNER,
    });
    stubMissingCredentialKeyring();
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "found", primaryCalendarId: OWNER },
    });

    await replaceEarlierGoogleCalendarCredentials({
      userId: USER_ID,
      credentialId: NEW_CREDENTIAL_ID,
      primaryCalendarId: OWNER,
      earlierCredentials,
      listNewConnectionCalendars,
    });

    expect(vi.mocked(lookUpGoogleAccount).mock.calls).toEqual([[null], [null]]);
    expect(await remainingCredentialIds()).toEqual([10, 11, 12, NEW_CREDENTIAL_ID]);
  });

  test("replaces the earlier credential of the same account and moves its calendars", async () => {
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    await findAndReplace();

    // Credential 11 uses owner@example.com as a shared calendar, but its token belongs to another account
    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
    const selectedCalendars = await prismock.selectedCalendar.findMany();
    expect(Object.fromEntries(selectedCalendars.map(({ id, credentialId }) => [id, credentialId]))).toEqual({
      "primary-of-10": NEW_CREDENTIAL_ID,
      "work-of-10": NEW_CREDENTIAL_ID,
      "primary-of-12": 12,
    });
    const destinationCalendars = await prismock.destinationCalendar.findMany();
    expect(
      Object.fromEntries(destinationCalendars.map(({ id, credentialId }) => [id, credentialId]))
    ).toEqual({ 1: NEW_CREDENTIAL_ID, 2: 11 });
    expect(await prismock.bookingReference.findUnique({ where: { id: 1 } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
    // Another user's connection to the same account is never looked up or touched
    expect(vi.mocked(lookUpGoogleAccount)).not.toHaveBeenCalledWith(tokenOf(12));
    // Google answered for every earlier token, so the new connection's calendars are not needed
    expect(listNewConnectionCalendars).not.toHaveBeenCalled();
  });

  test("replaces a revoked credential only when it used this account's primary calendar", async () => {
    await prismock.destinationCalendar.update({
      where: { id: 2 },
      data: { externalId: "personal@example.com" },
    });
    mockGoogleAccounts({
      10: { status: "grant_revoked" },
      11: { status: "grant_revoked" },
    });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
  });

  test("keeps a revoked credential of another account that has this calendar shared into it", async () => {
    // Credential 11 is the personal account: owner@example.com is shared into it as its destination, and
    // its own primary calendar is selected. Google can no longer say which account its dead token
    // belonged to, and the new connection cannot see personal@example.com, so replacing it would turn
    // those busy times free and drop its reconnect prompt.
    await prismock.selectedCalendar.create({
      data: {
        id: "primary-of-11",
        userId: USER_ID,
        integration: "google_calendar",
        externalId: "personal@example.com",
        credentialId: 11,
      },
    });
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "grant_revoked" },
    });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
    expect(listNewConnectionCalendars).toHaveBeenCalledTimes(1);
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "primary-of-11" } })).toMatchObject({
      credentialId: 11,
    });
    expect(await prismock.destinationCalendar.findUnique({ where: { id: 2 } })).toMatchObject({
      credentialId: 11,
    });
    // The earlier credential of the same account is still replaced
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "work-of-10" } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
  });

  test("replaces a revoked credential when the new connection keeps every calendar it had", async () => {
    // Credential 10 is a dead earlier connection of owner@example.com: the new connection can read its
    // selected calendars and write to its destination, so replacing it loses nothing
    mockGoogleAccounts({
      10: { status: "grant_revoked" },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
    const selectedCalendars = await prismock.selectedCalendar.findMany();
    expect(Object.fromEntries(selectedCalendars.map(({ id, credentialId }) => [id, credentialId]))).toEqual({
      "primary-of-10": NEW_CREDENTIAL_ID,
      "work-of-10": NEW_CREDENTIAL_ID,
      "primary-of-12": 12,
    });
    expect(await prismock.destinationCalendar.findUnique({ where: { id: 1 } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
    expect(await prismock.bookingReference.findUnique({ where: { id: 1 } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
  });

  test("keeps a revoked credential whose destination the new connection cannot write to", async () => {
    listNewConnectionCalendars.mockResolvedValue([
      { externalId: OWNER, readOnly: false },
      { externalId: WORK, readOnly: true },
    ]);
    mockGoogleAccounts({ 10: { status: "grant_revoked" }, 11: { status: "unknown" } });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([10, 11, 12, NEW_CREDENTIAL_ID]);
  });

  test("keeps a revoked credential when the new connection's calendars cannot be listed", async () => {
    listNewConnectionCalendars.mockRejectedValue(new Error("network"));
    mockGoogleAccounts({
      10: { status: "grant_revoked" },
      11: { status: "found", primaryCalendarId: OWNER },
    });

    await findAndReplace();

    // Credential 11 is still replaced: Google said its token belongs to owner@example.com
    expect(await remainingCredentialIds()).toEqual([10, 12, NEW_CREDENTIAL_ID]);
  });

  test("ignores rows another tenant pointed at the user's earlier credential", async () => {
    // Another tenant wrote rows that name user 1's dead credential 10 and a calendar the new
    // connection cannot see, to make the replace keep it
    const ATTACKER_ID = 3;
    await prismock.user.create({ data: { id: ATTACKER_ID, email: "user3@flowko.si", username: "user3" } });
    await prismock.selectedCalendar.create({
      data: {
        id: "planted",
        userId: ATTACKER_ID,
        integration: "google_calendar",
        externalId: "not-visible@group.calendar.google.com",
        credentialId: 10,
      },
    });
    await prismock.destinationCalendar.create({
      data: {
        id: 3,
        userId: ATTACKER_ID,
        integration: "google_calendar",
        externalId: "not-visible@group.calendar.google.com",
        credentialId: 10,
      },
    });
    mockGoogleAccounts({
      10: { status: "grant_revoked" },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    const earlierCredentials = await findAndReplace();

    expect(earlierCredentials.find(({ id }) => id === 10)).toMatchObject({
      selectedCalendarIds: [OWNER, WORK],
      destinationCalendarIds: [WORK],
    });
    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
    // The other tenant's rows never move onto the user's new credential
    expect((await prismock.selectedCalendar.findUnique({ where: { id: "planted" } }))?.credentialId).not.toBe(
      NEW_CREDENTIAL_ID
    );
    expect((await prismock.destinationCalendar.findUnique({ where: { id: 3 } }))?.credentialId).not.toBe(
      NEW_CREDENTIAL_ID
    );
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "work-of-10" } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
  });

  test("replaces an invalid credential of the same account whose key cannot be decrypted", async () => {
    // I-INVALID: Google already refused credential 10's grant, so an undecryptable key reads like a lookup
    // Google did not answer, and the replace loses no calendar
    await prismock.credential.update({
      where: { id: 10 },
      data: { invalid: true, encryptedKey: encryptedFieldsOf(10, OTHER_USER_ID).encryptedKey },
    });
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: "someone-else@example.com" },
      11: { status: "found", primaryCalendarId: "personal@example.com" },
    });

    await findAndReplace();

    expect(vi.mocked(lookUpGoogleAccount)).toHaveBeenCalledWith(null);
    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "work-of-10" } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
  });

  test("replaces an invalid credential of the same account when Google does not answer its lookup", async () => {
    // invalidateCredential marked credential 10 when Google refused its grant; the lookup now times out.
    // Kept, its selected calendars would keep the booking page without slots (getCalendarsEvents fails
    // closed on them)
    await prismock.credential.update({ where: { id: 10 }, data: { invalid: true } });
    mockGoogleAccounts({ 11: { status: "found", primaryCalendarId: "personal@example.com" } });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
    const invalidCredentialIds = (
      await prismock.credential.findMany({ where: { invalid: true }, select: { id: true } })
    ).map(({ id }) => id);
    expect(
      await prismock.selectedCalendar.count({ where: { credentialId: { in: invalidCredentialIds } } })
    ).toBe(0);
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "work-of-10" } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
    expect(await prismock.destinationCalendar.findUnique({ where: { id: 1 } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
  });

  test("keeps an invalid credential that Google cannot identify when replacing it would lose a calendar", async () => {
    // Same fail-closed rule as a revoked grant: the new connection cannot read personal@example.com
    await prismock.credential.update({ where: { id: 11 }, data: { invalid: true } });
    await prismock.selectedCalendar.create({
      data: {
        id: "primary-of-11",
        userId: USER_ID,
        integration: "google_calendar",
        externalId: "personal@example.com",
        credentialId: 11,
      },
    });
    mockGoogleAccounts({ 10: { status: "found", primaryCalendarId: OWNER } });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
  });

  test("keeps every credential when Google cannot say which account a token belongs to", async () => {
    mockGoogleAccounts({});

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([10, 11, 12, NEW_CREDENTIAL_ID]);
    expect(await prismock.selectedCalendar.findUnique({ where: { id: "work-of-10" } })).toMatchObject({
      credentialId: 10,
    });
  });
});
