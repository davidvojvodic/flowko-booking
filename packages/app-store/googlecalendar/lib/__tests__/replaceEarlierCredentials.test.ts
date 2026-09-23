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
    ["work-of-10", USER_ID, "work@group.calendar.google.com", 10],
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
      externalId: "work@group.calendar.google.com",
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
  });
  return earlierCredentials;
};

const remainingCredentialIds = async () =>
  (await prismock.credential.findMany({ select: { id: true } })).map(({ id }) => id).sort((a, b) => a - b);

describe("replaceEarlierGoogleCalendarCredentials", () => {
  beforeEach(async () => {
    vi.mocked(lookUpGoogleAccount).mockReset();
    await seed();
  });

  test("finds only the user's own other Google Calendar credentials", async () => {
    const earlierCredentials = await findEarlierGoogleCalendarCredentials({
      userId: USER_ID,
      credentialId: NEW_CREDENTIAL_ID,
      primaryCalendarId: OWNER,
    });

    expect(earlierCredentials.map(({ id, usesPrimaryCalendar }) => ({ id, usesPrimaryCalendar }))).toEqual([
      { id: 10, usesPrimaryCalendar: true },
      { id: 11, usesPrimaryCalendar: true },
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

  test("counts a revoked credential that used this primary calendar as the same account", async () => {
    // Google can no longer say which account a dead token belonged to. Credential 11 uses
    // owner@gmail.com as a destination, so it is replaced like a dead earlier connection of
    // owner@gmail.com would be. Its token no longer works either way, and its calendars move to the
    // new credential instead of being deleted.
    mockGoogleAccounts({
      10: { status: "found", primaryCalendarId: OWNER },
      11: { status: "grant_revoked" },
    });

    await findAndReplace();

    expect(await remainingCredentialIds()).toEqual([12, NEW_CREDENTIAL_ID]);
    expect(await prismock.destinationCalendar.findUnique({ where: { id: 2 } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
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
