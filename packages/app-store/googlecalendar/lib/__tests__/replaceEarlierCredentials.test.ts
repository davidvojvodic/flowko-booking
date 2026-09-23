import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { beforeEach, describe, expect, test, vi } from "vitest";

import type { GoogleAccountLookup } from "../lookUpGoogleAccount";
import { lookUpGoogleAccount } from "../lookUpGoogleAccount";
import {
  findEarlierGoogleCalendarCredentials,
  replaceEarlierGoogleCalendarCredentials,
} from "../replaceEarlierCredentials";

vi.mock("../lookUpGoogleAccount", () => ({ lookUpGoogleAccount: vi.fn() }));

const OWNER = "owner@gmail.com";
const WORK = "work@group.calendar.google.com";
const USER_ID = 1;
const OTHER_USER_ID = 2;
const NEW_CREDENTIAL_ID = 20;

const tokenOf = (credentialId: number) => ({
  access_token: `access-${credentialId}`,
  refresh_token: `refresh-${credentialId}`,
});

const mockGoogleAccounts = (accounts: Record<number, GoogleAccountLookup>) => {
  vi.mocked(lookUpGoogleAccount).mockImplementation(async (key) => {
    const credentialId = Number(String((key as { refresh_token: string }).refresh_token).split("-")[1]);
    return accounts[credentialId] ?? { status: "unknown" };
  });
};

const createGoogleCredential = (id: number, userId: number) =>
  prismock.credential.create({
    data: { id, type: "google_calendar", appId: "google-calendar", userId, key: tokenOf(id) },
  });

/**
 * User 1 reconnected owner@gmail.com (credential 20 is the new one). Credential 10 is their earlier
 * connection of the same account; credential 11 is their personal account, which has owner@gmail.com
 * shared into it and uses it as a destination. User 2 connected owner@gmail.com too (credential 12).
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
  await prismock.destinationCalendar.create({
    data: { id: 2, integration: "google_calendar", externalId: OWNER, credentialId: 11 },
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

/** What the new connection to owner@gmail.com sees: its own primary calendar and the work calendar */
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
    vi.mocked(lookUpGoogleAccount).mockReset();
    listNewConnectionCalendars.mockReset().mockResolvedValue(OWNER_CALENDARS);
    await seed();
  });

  test("finds only the user's own other Google Calendar credentials", async () => {
    const earlierCredentials = await findEarlierGoogleCalendarCredentials({
      userId: USER_ID,
      credentialId: NEW_CREDENTIAL_ID,
      primaryCalendarId: OWNER,
    });

    expect(earlierCredentials.map(({ key: _key, ...credential }) => credential)).toEqual([
      {
        id: 10,
        usesPrimaryCalendar: true,
        selectedCalendarIds: [OWNER, WORK],
        destinationCalendarIds: [WORK],
      },
      { id: 11, usesPrimaryCalendar: true, selectedCalendarIds: [], destinationCalendarIds: [OWNER] },
    ]);
  });

  test("replaces the earlier credential of the same account and moves its calendars", async () => {
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "found", primaryCalendarId: "personal@gmail.com" },
    });

    await findAndReplace();

    // Credential 11 uses owner@gmail.com as a shared calendar, but its token belongs to another account
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
      data: { externalId: "personal@gmail.com" },
    });
    mockGoogleAccounts({
      10: { status: "grant_revoked" },
      11: { status: "grant_revoked" },
    });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([11, 12, NEW_CREDENTIAL_ID]);
  });

  test("keeps a revoked credential of another account that has this calendar shared into it", async () => {
    // Credential 11 is the personal account: owner@gmail.com is shared into it as its destination, and
    // its own primary calendar is selected. Google can no longer say which account its dead token
    // belonged to, and the new connection cannot see personal@gmail.com, so replacing it would turn
    // those busy times free and drop its reconnect prompt.
    await prismock.selectedCalendar.create({
      data: {
        id: "primary-of-11",
        userId: USER_ID,
        integration: "google_calendar",
        externalId: "personal@gmail.com",
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
    // Credential 10 is a dead earlier connection of owner@gmail.com: the new connection can read its
    // selected calendars and write to its destination, so replacing it loses nothing
    mockGoogleAccounts({
      10: { status: "grant_revoked" },
      11: { status: "found", primaryCalendarId: "personal@gmail.com" },
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

    // Credential 11 is still replaced: Google said its token belongs to owner@gmail.com
    expect(await remainingCredentialIds()).toEqual([10, 12, NEW_CREDENTIAL_ID]);
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
