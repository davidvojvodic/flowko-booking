import "@calcom/testing/lib/__mocks__/prisma";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { symmetricDecrypt } from "@calcom/lib/crypto";
import { decryptSecret, encryptSecret } from "@calcom/lib/crypto/keyring";
import logger from "@calcom/lib/logger";
import type { SelectedCalendar } from "@calcom/prisma/client";
import {
  encryptedTestCredentialFields,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import type { EventBusyDate } from "@calcom/types/Calendar";
import type { CredentialForCalendarService, CredentialPayload } from "@calcom/types/Credential";

import getCalendarsEvents, {
  getCalendarsEventsWithTimezones,
  filterSelectedCalendarsForCredential,
} from "./getCalendarsEvents";

vi.mock("@calcom/lib/crypto", () => ({
  symmetricDecrypt: vi.fn(),
}));

const mockedSymmetricDecrypt = vi.mocked(symmetricDecrypt);

const mockGoogleGetAvailability = vi.fn().mockResolvedValue([]);
const mockGoogleGetAvailabilityWithTimeZones = vi.fn().mockResolvedValue([]);
const mockOfficeGetAvailability = vi.fn().mockResolvedValue([]);
const mockOfficeGetAvailabilityWithTimeZones = vi.fn().mockResolvedValue([]);
// Flowko U9f: the credential each Google calendar service was built with
const mockGoogleServiceCredentials: unknown[] = [];

vi.mock("@calcom/lib/crypto/keyring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/crypto/keyring")>();
  return { ...actual, decryptSecret: vi.fn(actual.decryptSecret) };
});

vi.mock("@calcom/app-store/calendar.services.generated", () => {
  return {
    CalendarServiceMap: {
      googlecalendar: Promise.resolve({
        default: (credential: { id: number }) => {
          mockGoogleServiceCredentials.push(credential);
          return {
            getCredentialId: () => credential.id,
            createEvent: vi.fn().mockResolvedValue({}),
            updateEvent: vi.fn().mockResolvedValue({}),
            deleteEvent: vi.fn().mockResolvedValue({}),
            getAvailability: mockGoogleGetAvailability,
            getAvailabilityWithTimeZones: mockGoogleGetAvailabilityWithTimeZones,
            listCalendars: vi.fn().mockResolvedValue([]),
          };
        },
      }),
      office365calendar: Promise.resolve({
        default: (credential: { id: number }) => ({
          getCredentialId: () => credential.id,
          createEvent: vi.fn().mockResolvedValue({}),
          updateEvent: vi.fn().mockResolvedValue({}),
          deleteEvent: vi.fn().mockResolvedValue({}),
          getAvailability: mockOfficeGetAvailability,
          getAvailabilityWithTimeZones: mockOfficeGetAvailabilityWithTimeZones,
          listCalendars: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
  };
});

function buildDelegationCredential(credential: CredentialPayload): CredentialForCalendarService {
  return {
    ...credential,
    id: -1,
    delegatedTo: {
      serviceAccountKey: {
        client_email: "client_email",
        tenant_id: "tenant_id",
        client_id: "client_id",
        private_key: "private_key",
      },
    },
  };
}

function buildRegularCredential(credential: CredentialPayload): CredentialForCalendarService {
  return {
    ...credential,
    delegatedTo: null,
    delegatedToId: null,
  };
}

function buildSelectedCalendar(credential: {
  credentialId: number;
  externalId: string;
  integration: string;
  userId: number;
  id: string;
}): SelectedCalendar {
  return {
    googleChannelId: null,
    googleChannelKind: null,
    googleChannelResourceId: null,
    eventTypeId: null,
    googleChannelResourceUri: null,
    googleChannelExpiration: null,
    delegationCredentialId: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastErrorAt: null,
    watchAttempts: 0,
    unwatchAttempts: 0,
    maxAttempts: 3,
    channelId: null,
    channelKind: null,
    channelResourceId: null,
    channelResourceUri: null,
    channelExpiration: null,
    syncSubscribedAt: null,
    syncSubscribedErrorAt: null,
    syncSubscribedErrorCount: 0,
    syncToken: null,
    syncedAt: null,
    syncErrorAt: null,
    syncErrorCount: 0,
    ...credential,
  };
}

describe("getCalendarsEvents", () => {
  let credential: CredentialPayload;

  beforeEach(() => {
    vi.spyOn(logger.constructor.prototype, "debug");

    credential = {
      id: 303,
      type: "google_calendar",
      key: {
        scope: "example scope",
        token_type: "Bearer",
        expiry_date: Date.now() + 84000,
        access_token: "access token",
        refresh_token: "refresh token",
      },
      userId: 808,
      teamId: null,
      user: {
        email: "test@example.com",
      },
      appId: "exampleApp",
      invalid: false,
      delegationCredentialId: null,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Regular Credentials", () => {
    it("should return empty array if no calendar credentials", async () => {
      const result = await getCalendarsEvents(
        [
          buildRegularCredential({
            ...credential,
            type: "totally_unrelated",
          }),
        ],
        "2010-12-01",
        "2010-12-02",
        [],
        "slots"
      );

      expect(result).toEqual([]);
    });

    it("should return unknown calendars as empty", async () => {
      const result = await getCalendarsEvents(
        [
          buildRegularCredential({
            ...credential,
            type: "unknown_calendar",
          }),
        ],
        "2010-12-01",
        "2010-12-02",
        [],
        "slots"
      );

      expect(result).toEqual([[]]);
    });

    it("should return unmatched calendars as empty", async () => {
      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "office365_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEvents(
        [
          buildRegularCredential({
            ...credential,
            type: "google_calendar",
          }),
        ],
        "2010-12-01",
        "2010-12-02",
        [selectedCalendar],
        "slots"
      );

      expect(result).toEqual([[]]);
    });

    it("should return availability from selected calendar", async () => {
      const availability: EventBusyDate[] = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
        },
        {
          start: new Date(2010, 11, 2, 4),
          end: new Date(2010, 11, 2, 16),
        },
      ];

      mockGoogleGetAvailability.mockResolvedValueOnce(availability);

      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEvents(
        [
          buildRegularCredential({
            ...credential,
            type: "google_calendar",
          }),
        ],
        "2010-12-01",
        "2010-12-04",
        [selectedCalendar],
        "slots"
      );

      expect(mockGoogleGetAvailability).toHaveBeenCalledWith({
        dateFrom: "2010-12-01",
        dateTo: "2010-12-04",
        selectedCalendars: [selectedCalendar],
        mode: "slots",
        fallbackToPrimary: false,
      });
      expect(result).toEqual([
        availability.map((av) => ({
          ...av,
          source: "exampleApp",
        })),
      ]);
    });

    it("should return availability from multiple calendars", async () => {
      const googleAvailability: EventBusyDate[] = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
        },
      ];
      const officeAvailability: EventBusyDate[] = [
        {
          start: new Date(2010, 11, 2, 4),
          end: new Date(2010, 11, 2, 16),
        },
      ];

      mockGoogleGetAvailability.mockResolvedValueOnce(googleAvailability);
      mockOfficeGetAvailability.mockResolvedValueOnce(officeAvailability);

      const selectedGoogleCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const selectedOfficeCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "office365_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEvents(
        [
          buildRegularCredential({
            ...credential,
            type: "google_calendar",
          }),
          buildRegularCredential({
            ...credential,
            type: "office365_calendar",
            key: {
              access_token: "access",
              refresh_token: "refresh",
              expires_in: Date.now() + 86400,
            },
          }),
        ],
        "2010-12-01",
        "2010-12-04",
        [selectedGoogleCalendar, selectedOfficeCalendar],
        "slots"
      );

      expect(mockGoogleGetAvailability).toHaveBeenCalledWith({
        dateFrom: "2010-12-01",
        dateTo: "2010-12-04",
        selectedCalendars: [selectedGoogleCalendar],
        mode: "slots",
        fallbackToPrimary: false,
      });
      expect(mockOfficeGetAvailability).toHaveBeenCalledWith({
        dateFrom: "2010-12-01",
        dateTo: "2010-12-04",
        selectedCalendars: [selectedOfficeCalendar],
        mode: "slots",
        fallbackToPrimary: false,
      });
      expect(result).toEqual([
        googleAvailability.map((av) => ({
          ...av,
          source: "exampleApp",
        })),
        officeAvailability.map((av) => ({
          ...av,
          source: "exampleApp",
        })),
      ]);
    });

    it("should not call getAvailability if selectedCalendars is empty", async () => {
      mockGoogleGetAvailability.mockClear();

      const result = await getCalendarsEvents(
        [buildRegularCredential(credential)],
        "2010-12-01",
        "2010-12-02",
        [],
        "slots"
      );

      expect(mockGoogleGetAvailability).not.toHaveBeenCalled();
      expect(result).toEqual([[]]);
    });
  });

  describe("Delegation Credentials", () => {
    it("should allow getAvailability call even without any selected calendars with allowFallbackToPrimary=true", async () => {
      const startDate = "2010-12-01";
      const endDate = "2010-12-02";
      const delegationCredential: CredentialForCalendarService = buildDelegationCredential(credential);
      const credentials = [delegationCredential];
      mockGoogleGetAvailability.mockResolvedValueOnce([]);

      const result = await getCalendarsEvents(credentials, startDate, endDate, [], "slots");

      expect(mockGoogleGetAvailability).toHaveBeenCalledWith({
        dateFrom: startDate,
        dateTo: endDate,
        selectedCalendars: [],
        mode: "slots",
        fallbackToPrimary: true,
      });
      expect(result).toEqual([[]]);
    });
  });
});

describe("getCalendarsEventsWithTimezones", () => {
  let credential: CredentialPayload;

  beforeEach(() => {
    vi.spyOn(logger.constructor.prototype, "debug");

    credential = {
      id: 303,
      type: "google_calendar",
      key: {
        scope: "example scope",
        token_type: "Bearer",
        expiry_date: Date.now() + 84000,
        access_token: "access token",
        refresh_token: "refresh token",
      },
      userId: 808,
      teamId: null,
      user: {
        email: "test@example.com",
      },
      appId: "exampleApp",
      invalid: false,
      delegationCredentialId: null,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Regular Credentials", () => {
    it("should return empty array if no calendar credentials", async () => {
      const result = await getCalendarsEventsWithTimezones(
        [
          buildRegularCredential({
            ...credential,
            type: "totally_unrelated",
          }),
        ],
        "2010-12-01",
        "2010-12-02",
        []
      );

      expect(result).toEqual([]);
    });

    it("should return unknown calendars as empty", async () => {
      const result = await getCalendarsEventsWithTimezones(
        [
          buildRegularCredential({
            ...credential,
            type: "unknown_calendar",
          }),
        ],
        "2010-12-01",
        "2010-12-02",
        []
      );

      expect(result).toEqual([]);
    });

    it("should return unmatched calendars as empty", async () => {
      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "office365_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEventsWithTimezones(
        [
          buildRegularCredential({
            ...credential,
            type: "google_calendar",
          }),
        ],
        "2010-12-01",
        "2010-12-02",
        [selectedCalendar]
      );

      expect(result).toEqual([[]]);
    });

    it("should return availability from selected calendar", async () => {
      const availability = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
          timeZone: "America/New_York",
        },
        {
          start: new Date(2010, 11, 2, 4),
          end: new Date(2010, 11, 2, 16),
          timeZone: "America/New_York",
        },
      ];

      mockGoogleGetAvailabilityWithTimeZones.mockResolvedValueOnce(availability);

      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEventsWithTimezones(
        [
          buildRegularCredential({
            ...credential,
            type: "google_calendar",
          }),
        ],
        "2010-12-01",
        "2010-12-04",
        [selectedCalendar]
      );

      expect(mockGoogleGetAvailabilityWithTimeZones).toHaveBeenCalledWith({
        dateFrom: "2010-12-01",
        dateTo: "2010-12-04",
        selectedCalendars: [selectedCalendar],
        mode: "slots",
        fallbackToPrimary: false,
      });
      expect(result).toEqual([
        availability.map((av) => ({
          ...av,
        })),
      ]);
    });

    it("should not call getAvailabilityWithTimezones if selectedCalendars is empty", async () => {
      mockGoogleGetAvailabilityWithTimeZones.mockClear();

      const result = await getCalendarsEventsWithTimezones(
        [buildRegularCredential(credential)],
        "2010-12-01",
        "2010-12-02",
        []
      );

      expect(mockGoogleGetAvailabilityWithTimeZones).not.toHaveBeenCalled();
      expect(result).toEqual([[]]);
    });
  });

  describe("Delegation Credentials", () => {
    it("should allow getAvailabilityWithTimezones call even without any selected calendars with allowFallbackToPrimary=true", async () => {
      const startDate = "2010-12-01";
      const endDate = "2010-12-02";
      const delegationCredential: CredentialForCalendarService = buildDelegationCredential(credential);
      const credentials = [delegationCredential];
      mockGoogleGetAvailabilityWithTimeZones.mockResolvedValueOnce([]);

      const result = await getCalendarsEventsWithTimezones(credentials, startDate, endDate, []);

      expect(mockGoogleGetAvailabilityWithTimeZones).toHaveBeenCalledWith({
        dateFrom: startDate,
        dateTo: endDate,
        selectedCalendars: [],
        mode: "slots",
        fallbackToPrimary: true,
      });
      expect(result).toEqual([[]]);
    });
  });

  describe("Invalid timezone handling", () => {
    it("should convert GMT-05:00 offset format to Etc/GMT+5", async () => {
      const availability = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
          timeZone: "GMT-05:00",
        },
        {
          start: new Date(2010, 11, 2, 4),
          end: new Date(2010, 11, 2, 16),
          timeZone: "America/New_York",
        },
      ];

      mockGoogleGetAvailabilityWithTimeZones.mockResolvedValueOnce(availability);

      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEventsWithTimezones(
        [buildRegularCredential(credential)],
        "2010-12-01",
        "2010-12-04",
        [selectedCalendar]
      );

      expect(result).toEqual([
        [
          {
            start: new Date(2010, 11, 2),
            end: new Date(2010, 11, 3),
            timeZone: "Etc/GMT+5",
          },
          {
            start: new Date(2010, 11, 2, 4),
            end: new Date(2010, 11, 2, 16),
            timeZone: "America/New_York",
          },
        ],
      ]);
    });

    it("should convert UTC+08:00 offset format to Etc/GMT-8", async () => {
      const availability = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
          timeZone: "UTC+08:00",
        },
      ];

      mockGoogleGetAvailabilityWithTimeZones.mockResolvedValueOnce(availability);

      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEventsWithTimezones(
        [buildRegularCredential(credential)],
        "2010-12-01",
        "2010-12-04",
        [selectedCalendar]
      );

      expect(result).toEqual([
        [
          {
            start: new Date(2010, 11, 2),
            end: new Date(2010, 11, 3),
            timeZone: "Etc/GMT-8",
          },
        ],
      ]);
    });

    it("should fallback to UTC when timezone is undefined", async () => {
      const availability = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
          timeZone: undefined,
        },
      ];

      mockGoogleGetAvailabilityWithTimeZones.mockResolvedValueOnce(availability);

      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEventsWithTimezones(
        [buildRegularCredential(credential)],
        "2010-12-01",
        "2010-12-04",
        [selectedCalendar]
      );

      expect(result).toEqual([
        [
          {
            start: new Date(2010, 11, 2),
            end: new Date(2010, 11, 3),
            timeZone: "UTC",
          },
        ],
      ]);
    });

    it("should fallback to UTC for completely invalid timezone formats", async () => {
      const availability = [
        {
          start: new Date(2010, 11, 2),
          end: new Date(2010, 11, 3),
          timeZone: "InvalidTimezone",
        },
      ];

      mockGoogleGetAvailabilityWithTimeZones.mockResolvedValueOnce(availability);

      const selectedCalendar: SelectedCalendar = buildSelectedCalendar({
        credentialId: 100,
        externalId: "externalId",
        integration: "google_calendar",
        userId: 200,
        id: "id",
      });
      const result = await getCalendarsEventsWithTimezones(
        [buildRegularCredential(credential)],
        "2010-12-01",
        "2010-12-04",
        [selectedCalendar]
      );

      expect(result).toEqual([
        [
          {
            start: new Date(2010, 11, 2),
            end: new Date(2010, 11, 3),
            timeZone: "UTC",
          },
        ],
      ]);
    });
  });
});

/**
 * Flowko U9f: the availability path decrypts nothing itself. It used to decrypt an upstream-style envelope
 * bound to {type} only and, when that failed, fell back to the plaintext in Credential.key. Now the stored
 * row goes to the calendar service as it is, and CalendarAuth is the only place a Google token is decrypted
 * (with the row's type, userId and teamId in the AAD).
 */
describe("Flowko U9f: the stored credential reaches the calendar service unchanged", () => {
  const TOKEN_A = { access_token: "token-a-access", refresh_token: "token-a-refresh", token_type: "Bearer" };
  const TOKEN_B = { access_token: "token-b-access", refresh_token: "token-b-refresh", token_type: "Bearer" };
  const DATE_FROM = "2026-10-01T00:00:00Z";
  const DATE_TO = "2026-10-02T00:00:00Z";
  const selectedCalendar = buildSelectedCalendar({
    credentialId: 303,
    externalId: "owner@example.com",
    integration: "google_calendar",
    userId: 808,
    id: "selected-owner",
  });

  const storedCredential = ({
    key,
    encryptedKey,
  }: Pick<CredentialForCalendarService, "key" | "encryptedKey">): CredentialForCalendarService =>
    buildRegularCredential({
      id: 303,
      type: "google_calendar",
      key,
      encryptedKey,
      userId: 808,
      teamId: null,
      user: { email: "owner@example.com" },
      appId: "google-calendar",
      invalid: false,
      delegationCredentialId: null,
    });

  // Upstream's CredentialDataService wrote envelopes like this one: bound to the credential type only
  const upstreamStyleEnvelopeOf = (token: object) =>
    JSON.stringify(
      encryptSecret({ ring: "CREDENTIALS", plaintext: JSON.stringify(token), aad: { type: "google_calendar" } })
    );

  const readBoth = (credential: CredentialForCalendarService) => [
    () => getCalendarsEvents([credential], DATE_FROM, DATE_TO, [selectedCalendar], "slots"),
    () => getCalendarsEventsWithTimezones([credential], DATE_FROM, DATE_TO, [selectedCalendar]),
  ];

  /** Reads availability both ways and returns the credential each Google calendar service was built with */
  const serviceCredentialsOfBothReads = async (credential: CredentialForCalendarService) => {
    const received: unknown[] = [];
    for (const read of readBoth(credential)) {
      mockGoogleServiceCredentials.length = 0;
      await read();
      received.push(...mockGoogleServiceCredentials);
    }
    return received;
  };

  const legacyFallbackWarnings = (warnSpy: { mock: { calls: unknown[][] } }) =>
    warnSpy.mock.calls.filter((args) => args.some((arg) => /legacy key|decrypt/i.test(String(arg))));

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGoogleServiceCredentials.length = 0;
    vi.mocked(decryptSecret).mockClear();
    stubTestCredentialKeyring();
    warnSpy = vi.spyOn(logger.constructor.prototype, "warn");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("passes the stored key B, not the plaintext A of an upstream-style {type} envelope", async () => {
    const credential = storedCredential({ key: TOKEN_B, encryptedKey: upstreamStyleEnvelopeOf(TOKEN_A) });
    const storedCopy = structuredClone(credential);

    const received = await serviceCredentialsOfBothReads(credential);

    expect(received).toHaveLength(2);
    for (const serviceCredential of received) {
      expect((serviceCredential as CredentialForCalendarService).key).toEqual(TOKEN_B);
      // The very row the caller loaded: nothing is decrypted, substituted or copied on the way
      expect(serviceCredential).toBe(credential);
    }
    expect(JSON.stringify(received)).not.toContain(TOKEN_A.access_token);
    expect(JSON.stringify(received)).not.toContain(TOKEN_A.refresh_token);
    expect(credential).toEqual(storedCopy);
    expect(decryptSecret).not.toHaveBeenCalled();
    expect(legacyFallbackWarnings(warnSpy)).toEqual([]);
  });

  it("passes a production row (placeholder key + envelope) as stored, with no legacy-key fallback", async () => {
    const credential = storedCredential(
      encryptedTestCredentialFields({ type: "google_calendar", userId: 808, teamId: null, key: TOKEN_A })
    );
    const storedCopy = structuredClone(credential);

    const received = await serviceCredentialsOfBothReads(credential);

    expect(decryptSecret).not.toHaveBeenCalled();
    expect(legacyFallbackWarnings(warnSpy)).toEqual([]);
    expect(received).toHaveLength(2);
    received.forEach((serviceCredential) => expect(serviceCredential).toBe(credential));
    expect(credential).toEqual(storedCopy);
    expect(JSON.stringify(received)).not.toContain(TOKEN_A.access_token);
  });

  it("never falls back to the plaintext in key when the keyring is missing, and logs no fallback", async () => {
    const credential = storedCredential({ key: TOKEN_B, encryptedKey: upstreamStyleEnvelopeOf(TOKEN_A) });
    stubMissingCredentialKeyring();

    const received = await serviceCredentialsOfBothReads(credential);

    expect(legacyFallbackWarnings(warnSpy)).toEqual([]);
    expect(decryptSecret).not.toHaveBeenCalled();
    // The row goes on as stored; CalendarAuth's decrypt then fails closed (U9b), never reading key
    expect(received).toHaveLength(2);
    received.forEach((serviceCredential) => expect(serviceCredential).toBe(credential));
  });
});

// CalDAV Credential Leak Prevention Tests
describe("CalDAV credential leak prevention", () => {
  function buildCalDAVCredential(data: {
    id: number;
    key: string;
    userId?: number;
  }): CredentialForCalendarService {
    return {
      id: data.id,
      type: "caldav_calendar",
      key: data.key,
      userId: data.userId || 1,
      user: { email: "test@example.com" },
      teamId: null,
      appId: "caldav-calendar",
      invalid: false,
      delegatedTo: null,
      delegationCredentialId: null,
    };
  }

  function buildCalDAVSelectedCalendar(data: {
    id: string;
    externalId: string;
    credentialId?: number;
  }): SelectedCalendar {
    return {
      id: data.id,
      userId: 1,
      integration: "caldav_calendar",
      externalId: data.externalId,
      credentialId: data.credentialId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      googleChannelId: null,
      googleChannelKind: null,
      googleChannelResourceId: null,
      googleChannelResourceUri: null,
      googleChannelExpiration: null,
      delegationCredentialId: null,
        error: null,
      lastErrorAt: null,
      watchAttempts: 0,
      unwatchAttempts: 0,
      maxAttempts: 3,
      eventTypeId: null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("filterSelectedCalendarsForCredential", () => {
    it("prevents CalDAV credential leak by matching server URLs", () => {
      // Setup: Two CalDAV servers with different URLs
      const serverACredential = buildCalDAVCredential({
        id: 1,
        key: "encrypted_server_a_key",
      });

      const serverBCredential = buildCalDAVCredential({
        id: 2,
        key: "encrypted_server_b_key",
      });

      // Mock encrypted credential data for different servers
      mockedSymmetricDecrypt
        .mockReturnValueOnce(
          JSON.stringify({
            username: "user_a",
            password: "pass_a",
            url: "https://server-a.example.com/dav/calendars/user/",
          })
        )
        .mockReturnValueOnce(
          JSON.stringify({
            username: "user_b",
            password: "pass_b",
            url: "https://server-b.example.com/dav/calendars/user/",
          })
        );

      // Selected calendars from both servers
      const selectedCalendars = [
        buildCalDAVSelectedCalendar({
          id: "cal_1",
          externalId: "https://server-a.example.com/dav/calendars/user/calendar1/",
          credentialId: 1,
        }),
        buildCalDAVSelectedCalendar({
          id: "cal_2",
          externalId: "https://server-b.example.com/dav/calendars/user/calendar2/",
          credentialId: 2,
        }),
      ];

      // Test Server A credential - should only return Server A calendars
      const serverACalendars = filterSelectedCalendarsForCredential(selectedCalendars, serverACredential);
      expect(serverACalendars).toHaveLength(1);
      expect(serverACalendars[0].externalId).toBe(
        "https://server-a.example.com/dav/calendars/user/calendar1/"
      );

      // Test Server B credential - should only return Server B calendars
      const serverBCalendars = filterSelectedCalendarsForCredential(selectedCalendars, serverBCredential);
      expect(serverBCalendars).toHaveLength(1);
      expect(serverBCalendars[0].externalId).toBe(
        "https://server-b.example.com/dav/calendars/user/calendar2/"
      );
    });

    it("demonstrates the credential leak that existed before the fix", () => {
      // This test shows what WOULD happen with naive filtering (integration type only)
      const serverACredential = buildCalDAVCredential({
        id: 1,
        key: "encrypted_server_a_key",
      });

      const selectedCalendars = [
        buildCalDAVSelectedCalendar({
          id: "cal_1",
          externalId: "https://server-a.example.com/dav/calendars/user/calendar1/",
          credentialId: 1,
        }),
        buildCalDAVSelectedCalendar({
          id: "cal_2",
          externalId: "https://server-b.example.com/dav/calendars/user/calendar2/",
          credentialId: 2,
        }),
      ];

      // Legacy filtering (type-only) would return ALL CalDAV calendars
      const legacyFiltering = selectedCalendars.filter((sc) => sc.integration === "caldav_calendar");
      expect(legacyFiltering).toHaveLength(2); // This demonstrates the leak - both calendars returned

      // Our new filtering prevents this
      mockedSymmetricDecrypt.mockReturnValue(
        JSON.stringify({
          username: "user_a",
          password: "pass_a",
          url: "https://server-a.example.com/dav/calendars/user/",
        })
      );

      const secureFiltering = filterSelectedCalendarsForCredential(selectedCalendars, serverACredential);
      expect(secureFiltering).toHaveLength(1); // Only calendars from matching server
      expect(secureFiltering[0].externalId).toContain("server-a.example.com");
    });

    it("handles non-CalDAV calendars normally", () => {
      const googleCredential: CredentialForCalendarService = {
        id: 1,
        type: "google_calendar",
        key: "google_key",
        userId: 1,
        user: { email: "test@example.com" },
        teamId: null,
        appId: "google-calendar",
        invalid: false,
        delegatedTo: null,
        delegationCredentialId: null,
      };

      const selectedCalendars = [
        buildCalDAVSelectedCalendar({
          id: "cal_1",
          externalId: "https://server-a.example.com/dav/calendars/user/calendar1/",
        }),
        {
          ...buildCalDAVSelectedCalendar({
            id: "cal_2",
            externalId: "primary",
          }),
          integration: "google_calendar",
        },
      ];

      const googleCalendars = filterSelectedCalendarsForCredential(selectedCalendars, googleCredential);
      expect(googleCalendars).toHaveLength(1);
      expect(googleCalendars[0].integration).toBe("google_calendar");
    });

    it("handles invalid CalDAV credential URLs gracefully", () => {
      const invalidCredential = buildCalDAVCredential({
        id: 1,
        key: "encrypted_invalid_key",
      });

      mockedSymmetricDecrypt.mockReturnValue(
        JSON.stringify({
          username: "user",
          password: "pass",
          url: "invalid-url-format",
        })
      );

      const selectedCalendars = [
        buildCalDAVSelectedCalendar({
          id: "cal_1",
          externalId: "https://server-a.example.com/dav/calendars/user/calendar1/",
        }),
      ];

      const result = filterSelectedCalendarsForCredential(selectedCalendars, invalidCredential);
      expect(result).toHaveLength(0); // Should return empty array for safety
    });
  });
});
