import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import getCalendarsEvents, {
  InvalidCalendarCredentialError,
} from "@calcom/features/calendars/lib/getCalendarsEvents";
import handleDeleteCredential from "@calcom/features/credentials/handleDeleteCredential";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import { SelectedCalendarRepository } from "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository";
import { getTestEmails, resetTestEmails } from "@calcom/lib/testEmails";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";
import {
  encryptedTestCredentialFields,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import type { SelectedCalendar } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

import { invalidateCredential } from "../../../_utils/invalidateCredential";
import type { GoogleAccountLookup } from "../lookUpGoogleAccount";
import { lookUpGoogleAccount } from "../lookUpGoogleAccount";
import {
  findEarlierGoogleCalendarCredentials,
  replaceEarlierGoogleCalendarCredentials,
} from "../replaceEarlierCredentials";

/**
 * Flowko: the whole life of a broken Google connection. The grant breaks (invalidateCredential), the
 * booking page stops offering slots (getCalendarsEvents fails closed) and the host is told once; then a
 * reconnect of the same account, or removing the dead connection, gives the page its slots back.
 */

const mocks = vi.hoisted(() => ({
  deadCredentialIds: new Set<number>(),
  getAvailability: vi.fn(),
  revokeToken: vi.fn(),
}));

vi.mock("@calcom/app-store/calendar.services.generated", () => ({
  CalendarServiceMap: {
    googlecalendar: Promise.resolve({
      default: (credential: { id: number }) => ({
        getCredentialId: () => credential.id,
        getAvailability: mocks.getAvailability,
        listCalendars: async () => {
          // A dead grant cannot list anything
          if (mocks.deadCredentialIds.has(credential.id)) throw new Error("invalid_grant");
          return [{ externalId: OWNER, primary: true, integration: "google_calendar" }];
        },
      }),
    }),
  },
}));

vi.mock("../lookUpGoogleAccount", () => ({ lookUpGoogleAccount: vi.fn() }));

vi.mock("googleapis-common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("googleapis-common")>()),
  OAuth2Client: class {
    revokeToken = mocks.revokeToken;
  },
}));

const USER_ID = 1;
const OLD_CREDENTIAL_ID = 10;
const NEW_CREDENTIAL_ID = 20;
const OWNER = "frizerstvo.ana@example.com";
const COLLEAGUE = "kolegica@example.com";

const seed = async ({ extraSelectedCalendar }: { extraSelectedCalendar?: string } = {}) => {
  await prismock.app.create({
    data: { slug: "google-calendar", dirName: "googlecalendar", categories: ["calendar"], enabled: true },
  });
  await prismock.user.create({
    data: { id: USER_ID, email: "frizerstvo@flowko.si", username: "frizerstvo", locale: "sl" },
  });
  await prismock.credential.create({
    data: {
      id: OLD_CREDENTIAL_ID,
      type: "google_calendar",
      appId: "google-calendar",
      userId: USER_ID,
      // Flowko U9: stored as production stores it (key = placeholder, token encrypted in encryptedKey)
      ...encryptedTestCredentialFields({
        type: "google_calendar",
        userId: USER_ID,
        teamId: null,
        key: { access_token: "old-access", refresh_token: "old-refresh" },
      }),
    },
  });
  for (const externalId of [OWNER, ...(extraSelectedCalendar ? [extraSelectedCalendar] : [])]) {
    await prismock.selectedCalendar.create({
      data: {
        id: `selected-${externalId}`,
        userId: USER_ID,
        integration: "google_calendar",
        externalId,
        credentialId: OLD_CREDENTIAL_ID,
      },
    });
  }
  await prismock.destinationCalendar.create({
    data: {
      id: 1,
      userId: USER_ID,
      integration: "google_calendar",
      externalId: OWNER,
      credentialId: OLD_CREDENTIAL_ID,
    },
  });
};

/** What getUserAvailability hands to getBusyCalendarTimes for the host */
const readHostAvailability = async () => {
  const credentials = await prismock.credential.findMany({
    where: { userId: USER_ID },
    select: credentialForCalendarServiceSelect,
  });
  const selectedCalendars = await prismock.selectedCalendar.findMany({
    where: { userId: USER_ID, eventTypeId: null },
  });
  return getCalendarsEvents(
    credentials.map((credential) => ({ ...credential, delegatedTo: null })) as CredentialForCalendarService[],
    "2026-10-01T00:00:00Z",
    "2026-10-02T00:00:00Z",
    selectedCalendars as SelectedCalendar[],
    "slots"
  );
};

/** The Google callback's steps for a reconnect of the same account (api/callback.ts) */
const reconnectSameAccount = async (oldTokenLookup: GoogleAccountLookup) => {
  vi.mocked(lookUpGoogleAccount).mockResolvedValue(oldTokenLookup);
  await prismock.credential.create({
    data: {
      id: NEW_CREDENTIAL_ID,
      type: "google_calendar",
      appId: "google-calendar",
      userId: USER_ID,
      // Flowko U9: the callback stores the new token encrypted, like every Google credential
      ...encryptedTestCredentialFields({
        type: "google_calendar",
        userId: USER_ID,
        teamId: null,
        key: { access_token: "new-access", refresh_token: "new-refresh" },
      }),
    },
  });
  const earlierCredentials = await findEarlierGoogleCalendarCredentials({
    userId: USER_ID,
    credentialId: NEW_CREDENTIAL_ID,
    primaryCalendarId: OWNER,
  });
  await SelectedCalendarRepository.upsert({
    userId: USER_ID,
    integration: "google_calendar",
    externalId: OWNER,
    credentialId: NEW_CREDENTIAL_ID,
    eventTypeId: null,
  });
  await replaceEarlierGoogleCalendarCredentials({
    userId: USER_ID,
    credentialId: NEW_CREDENTIAL_ID,
    primaryCalendarId: OWNER,
    earlierCredentials,
    listNewConnectionCalendars: async () => [{ externalId: OWNER, readOnly: false }],
  });
};

const breakOldGrant = async () => {
  mocks.deadCredentialIds.add(OLD_CREDENTIAL_ID);
  await invalidateCredential(OLD_CREDENTIAL_ID);
};

describe("a broken Google connection", () => {
  beforeEach(() => {
    mocks.deadCredentialIds.clear();
    mocks.getAvailability.mockReset().mockResolvedValue([]);
    mocks.revokeToken.mockReset().mockResolvedValue(undefined);
    vi.mocked(lookUpGoogleAccount).mockReset();
    resetTestEmails();
    Reflect.set(FeaturesRepository, "featuresCache", null);
    // Flowko U9: the stored tokens are decrypted with the test keyring (the disconnect revokes with them)
    stubTestCredentialKeyring();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks the slots and tells the host once", async () => {
    await seed();
    await expect(readHostAvailability()).resolves.toEqual([[]]);

    await breakOldGrant();
    await breakOldGrant();

    await expect(readHostAvailability()).rejects.toBeInstanceOf(InvalidCalendarCredentialError);
    expect(getTestEmails()).toHaveLength(1);
    expect(getTestEmails()[0].subject).toBe("Povezava z Google Calendar ne deluje");
  });

  it.each([
    ["Google says the old grant is revoked", { status: "grant_revoked" } as const],
    ["Google does not answer for the old token", { status: "unknown" } as const],
  ])("gets its slots back after a reconnect of the same account (%s)", async (_label, oldTokenLookup) => {
    await seed();
    await breakOldGrant();
    await expect(readHostAvailability()).rejects.toBeInstanceOf(InvalidCalendarCredentialError);

    await reconnectSameAccount(oldTokenLookup);

    const credentials = await prismock.credential.findMany({ select: { id: true, invalid: true } });
    expect(credentials).toEqual([{ id: NEW_CREDENTIAL_ID, invalid: false }]);
    expect(await prismock.destinationCalendar.findUnique({ where: { id: 1 } })).toMatchObject({
      credentialId: NEW_CREDENTIAL_ID,
    });
    await expect(readHostAvailability()).resolves.toEqual([[]]);
    expect(mocks.getAvailability).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedCalendars: [expect.objectContaining({ externalId: OWNER, credentialId: NEW_CREDENTIAL_ID })],
      })
    );
  });

  it("stays blocked when the reconnect cannot take over a calendar, until the host removes the dead connection", async () => {
    // The dead connection also checked a colleague's shared calendar, which the new connection cannot
    // read, so the reconnect keeps it (replacing it would turn that calendar's busy times free)
    await seed({ extraSelectedCalendar: COLLEAGUE });
    await breakOldGrant();
    await reconnectSameAccount({ status: "grant_revoked" });

    expect(await prismock.credential.findUnique({ where: { id: OLD_CREDENTIAL_ID } })).toMatchObject({
      invalid: true,
    });
    await expect(readHostAvailability()).rejects.toBeInstanceOf(InvalidCalendarCredentialError);
    // Google refuses to revoke a dead token
    mocks.revokeToken.mockRejectedValue(Object.assign(new Error("invalid_token"), { code: 400 }));

    // "Odstrani aplikacijo" on the dead connection: its token cannot list calendars
    await expect(
      handleDeleteCredential({ userId: USER_ID, userMetadata: {}, credentialId: OLD_CREDENTIAL_ID })
    ).resolves.toBeUndefined();

    expect(await prismock.credential.findUnique({ where: { id: OLD_CREDENTIAL_ID } })).toBeNull();
    expect(await prismock.selectedCalendar.findMany({ where: { credentialId: OLD_CREDENTIAL_ID } })).toEqual(
      []
    );
    await expect(readHostAvailability()).resolves.toEqual([[]]);
    // Flowko D8: the dead token can't list its calendars, so its Google account is unknown and nothing
    // confirms that the new connection shares its grant: its revoke is attempted. Google refuses it
    // (invalid_token), and the new connection's grant is untouched
    expect(mocks.revokeToken).toHaveBeenCalledTimes(1);
    expect(mocks.revokeToken).toHaveBeenCalledWith("old-refresh");
    expect(await prismock.credential.findUnique({ where: { id: NEW_CREDENTIAL_ID } })).toMatchObject({
      invalid: false,
    });
  });

  it("can be removed while it is the host's only connection", async () => {
    await seed();
    await breakOldGrant();
    mocks.revokeToken.mockRejectedValue(Object.assign(new Error("invalid_token"), { code: 400 }));

    await expect(
      handleDeleteCredential({ userId: USER_ID, userMetadata: {}, credentialId: OLD_CREDENTIAL_ID })
    ).resolves.toBeUndefined();

    // The revoke at Google was attempted, best effort
    expect(mocks.revokeToken).toHaveBeenCalledWith("old-refresh");
    expect(await prismock.credential.findMany()).toEqual([]);
    await expect(readHostAvailability()).resolves.toEqual([]);
  });
});
