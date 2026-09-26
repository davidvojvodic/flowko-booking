import oAuthManagerMock, {
  defaultMockOAuthManager,
  setFullMockOAuthManagerRequest,
} from "../../../tests/__mocks__/OAuthManager";
import "../__mocks__/features.repository";
import "../__mocks__/getGoogleAppKeys";
import {
  adminMock,
  calendarListMock,
  calendarMock,
  freebusyQueryMock,
  setCredentialsMock,
  setLastCreatedJWT,
  setLastCreatedOAuth2Client,
} from "../__mocks__/googleapis";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "vitest-fetch-mock";

import {
  encryptedTestCredentialFields,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import type { IntegrationCalendar } from "@calcom/types/Calendar";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";
import BuildCalendarService, { GoogleCalendarFreeBusyError } from "../CalendarService";
import { createMockJWTInstance } from "./utils";

// Flowko: Google's freebusy.query answers a calendar it could not read with errors[] and an empty busy[].
// Such a calendar must not look free: every path that asks Google for free/busy has to fail closed.

const getCalendarMock = vi.hoisted(() => vi.fn());
vi.mock("@calcom/app-store/_utils/getCalendar", () => ({ getCalendar: getCalendarMock }));

beforeEach(() => {
  vi.clearAllMocks();
  setCredentialsMock.mockClear();
  oAuthManagerMock.OAuthManager = defaultMockOAuthManager;
  calendarMock.calendar_v3.Calendar.mockClear();
  adminMock.admin_directory_v1.Admin.mockClear();
  freebusyQueryMock.mockReset();
  calendarListMock.mockReset();

  setLastCreatedJWT(null);
  setLastCreatedOAuth2Client(null);
  createMockJWTInstance({});
  // Flowko U9: CalendarAuth decrypts the stored token, so the test keyring must be configured
  stubTestCredentialKeyring();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const mockCredential: CredentialForCalendarServiceWithEmail = {
  id: 1,
  userId: 1,
  appId: "google-calendar",
  type: "google_calendar",
  user: {
    email: "user@example.com",
  },
  delegationCredentialId: null,
  delegatedTo: null,
  invalid: false,
  teamId: null,
  // Flowko U9: stored as production stores it (key = placeholder, token encrypted in encryptedKey)
  ...encryptedTestCredentialFields({
    type: "google_calendar",
    userId: 1,
    teamId: null,
    key: {
      access_token: "<INVALID_TOKEN>",
    },
  }),
};

const READABLE_ID = "readable.calendar@example.com";
const UNREADABLE_ID = "unreadable.calendar@example.com";

const readableBusy = [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" }];
const notFound = [{ domain: "global", reason: "notFound" }];

const selectedCalendar = (externalId: string, credentialId?: number | null) =>
  ({ externalId, integration: "google_calendar", credentialId }) as unknown as IntegrationCalendar;

/** Answers every requested calendar like Google does, with `errorsFor` naming the ones it could not read */
const mockFreeBusy = (errorsFor: Record<string, { domain: string; reason: string }[]> = {}) => {
  freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: { items: { id: string }[] } }) => {
    const calendars: Record<string, unknown> = {};
    requestBody.items.forEach(({ id }) => {
      calendars[id] = errorsFor[id] ? { errors: errorsFor[id], busy: [] } : { busy: readableBusy };
    });
    return { data: { kind: "calendar#freeBusy", calendars } };
  });
};

const buildService = () => {
  const calendarService = BuildCalendarService(mockCredential);
  setFullMockOAuthManagerRequest();
  return calendarService;
};

describe("getFreeBusyData", () => {
  test("throws when Google could not read one of the requested calendars", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({
      data: {
        calendars: {
          [READABLE_ID]: { busy: readableBusy },
          [UNREADABLE_ID]: { errors: notFound, busy: [] },
        },
      },
    });

    const error = await (calendarService as any)
      .getFreeBusyData({
        timeMin: "2024-01-01T00:00:00Z",
        timeMax: "2024-01-02T00:00:00Z",
        items: [{ id: READABLE_ID }, { id: UNREADABLE_ID }],
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GoogleCalendarFreeBusyError);
    expect(error.reasons).toEqual(["notFound"]);
    expect(error.calendarCount).toBe(1);
  });

  test("returns the same intervals as before when every calendar was read", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({
      data: {
        calendars: {
          [READABLE_ID]: { busy: readableBusy },
          // Google may send an empty errors array for a calendar it read
          "second@example.com": {
            errors: [],
            busy: [{ start: "2024-01-01T12:00:00Z", end: "2024-01-01T13:00:00Z" }],
          },
          "empty@example.com": { busy: [] },
        },
      },
    });

    const result = await (calendarService as any).getFreeBusyData({
      timeMin: "2024-01-01T00:00:00Z",
      timeMax: "2024-01-02T00:00:00Z",
      items: [{ id: READABLE_ID }, { id: "second@example.com" }, { id: "empty@example.com" }],
    });

    expect(result).toEqual([
      { id: READABLE_ID, start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" },
      { id: "second@example.com", start: "2024-01-01T12:00:00Z", end: "2024-01-01T13:00:00Z" },
    ]);
  });

  test("counts every unreadable calendar and reports each reason once", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({
      data: {
        calendars: {
          [UNREADABLE_ID]: { errors: notFound, busy: [] },
          "second@example.com": { errors: [{ domain: "global", reason: "backendError" }], busy: [] },
          "third@example.com": { errors: notFound, busy: [] },
          [READABLE_ID]: { busy: readableBusy },
        },
      },
    });

    const error = await (calendarService as any)
      .getFreeBusyData({ timeMin: "2024-01-01T00:00:00Z", timeMax: "2024-01-02T00:00:00Z", items: [] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GoogleCalendarFreeBusyError);
    expect(error.calendarCount).toBe(3);
    expect(error.reasons).toEqual(["backendError", "notFound"]);
  });

  test("throws when Google could not expand a requested group", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({
      data: {
        groups: { "group@example.com": { errors: [{ domain: "global", reason: "groupTooBig" }] } },
        calendars: { [READABLE_ID]: { busy: readableBusy } },
      },
    });

    const error = await (calendarService as any)
      .getFreeBusyData({
        timeMin: "2024-01-01T00:00:00Z",
        timeMax: "2024-01-02T00:00:00Z",
        items: [{ id: "group@example.com" }, { id: READABLE_ID }],
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GoogleCalendarFreeBusyError);
    expect(error.reasons).toEqual(["groupTooBig"]);
    expect(error.calendarCount).toBe(1);
  });

  test("does not put the calendar id or Google's free text into the error", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({
      data: {
        calendars: {
          [UNREADABLE_ID]: {
            // Not one of Google's documented reasons: must not be copied into the error verbatim
            errors: [{ domain: "global", reason: `no access to ${UNREADABLE_ID}` }],
            busy: [],
          },
        },
      },
    });

    const error = await (calendarService as any)
      .getFreeBusyData({
        timeMin: "2024-01-01T00:00:00Z",
        timeMax: "2024-01-02T00:00:00Z",
        items: [{ id: UNREADABLE_ID }],
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GoogleCalendarFreeBusyError);
    expect(error.reasons).toEqual(["unknown"]);
    expect(JSON.stringify([error.message, error.stack, { ...error }])).not.toContain(UNREADABLE_ID);
  });
});

describe("a requested calendar missing from Google's answer", () => {
  const MISSING_ID = "missing.calendar@example.com";

  test("is logged as a count, without the calendar id, and the answer is used as before", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({ data: { calendars: { [READABLE_ID]: { busy: readableBusy } } } });
    const warnSpy = vi.spyOn((calendarService as any).log, "warn");

    const result = await (calendarService as any).getFreeBusyData({
      timeMin: "2024-01-01T00:00:00Z",
      timeMax: "2024-01-02T00:00:00Z",
      items: [{ id: READABLE_ID }, { id: MISSING_ID }],
    });

    expect(result).toEqual([{ id: READABLE_ID, ...readableBusy[0] }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { unansweredCount: 1, requestedCount: 2 });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(MISSING_ID);
  });

  test("is not logged when Google answers every calendar, whatever the case of its keys", async () => {
    const calendarService = buildService();
    freebusyQueryMock.mockResolvedValue({
      data: { calendars: { [READABLE_ID.toUpperCase()]: { busy: readableBusy } } },
    });
    const warnSpy = vi.spyOn((calendarService as any).log, "warn");

    await (calendarService as any).getFreeBusyData({
      timeMin: "2024-01-01T00:00:00Z",
      timeMax: "2024-01-02T00:00:00Z",
      items: [{ id: READABLE_ID }],
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("convertFreeBusyToEventBusyDates", () => {
  test("throws for a calendar Google could not read and converts a readable response as before", () => {
    const calendarService = buildService() as any;

    expect(() =>
      calendarService.convertFreeBusyToEventBusyDates({
        calendars: { [READABLE_ID]: { busy: readableBusy }, [UNREADABLE_ID]: { errors: notFound, busy: [] } },
      })
    ).toThrow(GoogleCalendarFreeBusyError);
    expect(
      calendarService.convertFreeBusyToEventBusyDates({ calendars: { [READABLE_ID]: { busy: readableBusy } } })
    ).toEqual(readableBusy);
  });
});

describe("getAvailability fails closed on a calendar Google could not read", () => {
  test("throws for a selected calendar Google could not read", async () => {
    const calendarService = buildService();
    mockFreeBusy({ [UNREADABLE_ID]: notFound });

    await expect(
      calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [selectedCalendar(READABLE_ID), selectedCalendar(UNREADABLE_ID)],
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("returns the busy times when every selected calendar was read", async () => {
    const calendarService = buildService();
    mockFreeBusy();

    const result = await calendarService.getAvailability({
      dateFrom: "2024-01-01T00:00:00Z",
      dateTo: "2024-01-08T00:00:00Z",
      selectedCalendars: [selectedCalendar(READABLE_ID)],
      mode: "slots",
      fallbackToPrimary: false,
    });

    expect(result).toEqual(readableBusy);
  });

  test("throws when the primary calendar used as a fallback could not be read", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({ data: { items: [{ id: UNREADABLE_ID, primary: true }] } });
    mockFreeBusy({ [UNREADABLE_ID]: notFound });

    await expect(
      calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [],
        mode: "slots",
        fallbackToPrimary: true,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("throws when one chunk of a range longer than 90 days has an unreadable calendar", async () => {
    const calendarService = buildService();
    let call = 0;
    freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: { items: { id: string }[] } }) => {
      call++;
      const calendars: Record<string, unknown> = {};
      requestBody.items.forEach(({ id }) => {
        // Only the second of the three 90-day chunks fails, like a transient Google backend error
        calendars[id] =
          call === 2
            ? { errors: [{ domain: "global", reason: "backendError" }], busy: [] }
            : { busy: readableBusy };
      });
      return { data: { calendars } };
    });

    const error = await calendarService
      .getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-07-01T00:00:00Z",
        selectedCalendars: [selectedCalendar(READABLE_ID)],
        mode: "slots",
        fallbackToPrimary: false,
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GoogleCalendarFreeBusyError);
    expect(freebusyQueryMock).toHaveBeenCalledTimes(2);
  });

  test("throws when one chunk of a range longer than 90 days comes back without calendars", async () => {
    const calendarService = buildService();
    let call = 0;
    freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: { items: { id: string }[] } }) => {
      call++;
      if (call === 2) return { data: { kind: "calendar#freeBusy" } };
      const calendars: Record<string, unknown> = {};
      requestBody.items.forEach(({ id }) => {
        calendars[id] = { busy: readableBusy };
      });
      return { data: { calendars } };
    });

    await expect(
      calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-07-01T00:00:00Z",
        selectedCalendars: [selectedCalendar(READABLE_ID)],
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toThrow("No response from google calendar");
  });

  test("still joins the chunks of a range longer than 90 days when every calendar was read", async () => {
    const calendarService = buildService();
    mockFreeBusy();

    const result = await calendarService.getAvailability({
      dateFrom: "2024-01-01T00:00:00Z",
      dateTo: "2024-07-01T00:00:00Z",
      selectedCalendars: [selectedCalendar(READABLE_ID)],
      mode: "slots",
      fallbackToPrimary: false,
    });

    expect(freebusyQueryMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual([...readableBusy, ...readableBusy, ...readableBusy]);
  });

  test("logs the reasons and the count but not the calendar id", async () => {
    const calendarService = buildService();
    mockFreeBusy({ [UNREADABLE_ID]: notFound });
    const log = (calendarService as any).log;
    const logSpies = ["error", "warn", "info"].map((level) => vi.spyOn(log, level));

    await calendarService
      .getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [selectedCalendar(UNREADABLE_ID)],
        mode: "slots",
        fallbackToPrimary: false,
      })
      .catch(() => undefined);

    const logged = logSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(logSpies[0]).toHaveBeenCalledTimes(1);
    expect(logged).toContain("notFound");
    expect(logged).toContain('"calendarCount":1');
    expect(logged).not.toContain(UNREADABLE_ID);
  });
});

describe("getAvailabilityWithTimeZones fails closed on a calendar Google could not read", () => {
  test("throws for a selected calendar Google could not read", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({
      data: {
        items: [
          { id: READABLE_ID, timeZone: "Europe/Ljubljana" },
          { id: UNREADABLE_ID, timeZone: "Europe/Ljubljana" },
        ],
      },
    });
    mockFreeBusy({ [UNREADABLE_ID]: notFound });

    await expect(
      calendarService.getAvailabilityWithTimeZones!({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [selectedCalendar(READABLE_ID), selectedCalendar(UNREADABLE_ID)],
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("throws when the primary calendar used as a fallback could not be read", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({
      data: { items: [{ id: UNREADABLE_ID, primary: true, timeZone: "Europe/Ljubljana" }] },
    });
    mockFreeBusy({ [UNREADABLE_ID]: notFound });

    await expect(
      calendarService.getAvailabilityWithTimeZones!({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [],
        mode: "slots",
        fallbackToPrimary: true,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("still asks Google for the selected calendars when Google lists no calendars", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({ data: { items: [] } });
    mockFreeBusy({ [UNREADABLE_ID]: notFound });

    await expect(
      calendarService.getAvailabilityWithTimeZones!({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [selectedCalendar(UNREADABLE_ID)],
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
    expect(freebusyQueryMock).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({ items: [{ id: UNREADABLE_ID }] }),
    });
  });

  test("returns the busy times with their time zone when every calendar was read", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({
      data: { items: [{ id: READABLE_ID, timeZone: "Europe/Ljubljana" }] },
    });
    mockFreeBusy();

    const result = await calendarService.getAvailabilityWithTimeZones!({
      dateFrom: "2024-01-01T00:00:00Z",
      dateTo: "2024-01-08T00:00:00Z",
      selectedCalendars: [selectedCalendar(READABLE_ID)],
      mode: "slots",
      fallbackToPrimary: false,
    });

    expect(result).toEqual([{ ...readableBusy[0], timeZone: "Europe/Ljubljana" }]);
  });
});

describe("busy calendar times of a host with an unreadable Google calendar", () => {
  test("getBusyCalendarTimes reports a failure instead of a free calendar", async () => {
    const { getBusyCalendarTimes } = await import("@calcom/features/calendars/lib/CalendarManager");
    const calendarService = buildService();
    getCalendarMock.mockResolvedValue(calendarService);
    mockFreeBusy({ [UNREADABLE_ID]: notFound });

    const result = await getBusyCalendarTimes(
      [mockCredential],
      "2024-01-01T00:00:00Z",
      "2024-01-08T00:00:00Z",
      [
        {
          id: "selected-1",
          userId: 1,
          integration: "google_calendar",
          externalId: UNREADABLE_ID,
          credentialId: mockCredential.id,
          eventTypeId: null,
        } as any,
      ],
      "slots"
    );

    // getBusyTimes throws on success: false, so the host shows no slots and a booking is refused
    expect(result.success).toBe(false);
    expect(result.data).toEqual([expect.objectContaining({ source: "error-placeholder" })]);
  });
});

describe("a host with more than one Google account connected", () => {
  // Every Google connection of the host is asked for all of the host's selected Google calendars.
  // Google answers a calendar of another account that is not shared with this one with notFound.
  const OWN_ID = "own.calendar@example.com";
  const OTHER_ACCOUNT_ID = "other.calendar@example.org";
  const OTHER_CREDENTIAL_ID = 2;
  const otherAccountBusy = [{ start: "2024-01-02T09:00:00Z", end: "2024-01-02T10:00:00Z" }];

  const bothAccountsSelected = () => [
    selectedCalendar(OWN_ID, mockCredential.id),
    selectedCalendar(OTHER_ACCOUNT_ID, OTHER_CREDENTIAL_ID),
  ];

  test("getAvailability does not fail on a calendar selected under the other connection", async () => {
    const calendarService = buildService();
    mockFreeBusy({ [OTHER_ACCOUNT_ID]: notFound });

    const result = await calendarService.getAvailability({
      dateFrom: "2024-01-01T00:00:00Z",
      dateTo: "2024-01-08T00:00:00Z",
      selectedCalendars: bothAccountsSelected(),
      mode: "slots",
      fallbackToPrimary: false,
    });

    expect(result).toEqual(readableBusy);
  });

  test("getAvailability still fails on a calendar of its own that Google could not read", async () => {
    const calendarService = buildService();
    mockFreeBusy({ [OWN_ID]: notFound, [OTHER_ACCOUNT_ID]: notFound });

    await expect(
      calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: bothAccountsSelected(),
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("getAvailability fails on a selected calendar that belongs to no connection", async () => {
    const calendarService = buildService();
    mockFreeBusy({ [UNREADABLE_ID]: notFound, [OTHER_ACCOUNT_ID]: notFound });

    await expect(
      calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: [...bothAccountsSelected(), selectedCalendar(UNREADABLE_ID, null)],
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("getAvailability does not fail on the other connection's calendar in any chunk of a long range", async () => {
    const calendarService = buildService();
    mockFreeBusy({ [OTHER_ACCOUNT_ID]: notFound });

    const result = await calendarService.getAvailability({
      dateFrom: "2024-01-01T00:00:00Z",
      dateTo: "2024-07-01T00:00:00Z",
      selectedCalendars: bothAccountsSelected(),
      mode: "slots",
      fallbackToPrimary: false,
    });

    expect(freebusyQueryMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual([...readableBusy, ...readableBusy, ...readableBusy]);
  });

  test("getAvailabilityWithTimeZones does not fail on a calendar selected under the other connection", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({
      data: { items: [{ id: OWN_ID, timeZone: "Europe/Ljubljana" }] },
    });
    mockFreeBusy({ [OTHER_ACCOUNT_ID]: notFound });

    const result = await calendarService.getAvailabilityWithTimeZones!({
      dateFrom: "2024-01-01T00:00:00Z",
      dateTo: "2024-01-08T00:00:00Z",
      selectedCalendars: bothAccountsSelected(),
      mode: "slots",
      fallbackToPrimary: false,
    });

    expect(result).toEqual([{ ...readableBusy[0], timeZone: "Europe/Ljubljana" }]);
  });

  test("getAvailabilityWithTimeZones still fails on a calendar of its own that Google could not read", async () => {
    const calendarService = buildService();
    calendarListMock.mockResolvedValue({
      data: { items: [{ id: OWN_ID, timeZone: "Europe/Ljubljana" }] },
    });
    mockFreeBusy({ [OWN_ID]: notFound, [OTHER_ACCOUNT_ID]: notFound });

    await expect(
      calendarService.getAvailabilityWithTimeZones!({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: bothAccountsSelected(),
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  test("a delegation credential does not skip the error of any calendar", async () => {
    const calendarService = BuildCalendarService({
      ...mockCredential,
      id: -1,
      delegatedToId: "delegation-credential-1",
      // Flowko U9: a delegation credential is built in memory and CalendarAuth reads its key as is (the
      // delegation branch is unchanged), so it keeps the plaintext in-memory key, not the stored placeholder
      key: { access_token: "<INVALID_TOKEN>" },
    });
    setFullMockOAuthManagerRequest();
    mockFreeBusy({ [OTHER_ACCOUNT_ID]: notFound });

    await expect(
      calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-08T00:00:00Z",
        selectedCalendars: bothAccountsSelected(),
        mode: "slots",
        fallbackToPrimary: false,
      })
    ).rejects.toBeInstanceOf(GoogleCalendarFreeBusyError);
  });

  describe("getBusyCalendarTimes with both connections", () => {
    const otherCredential: CredentialForCalendarServiceWithEmail = {
      ...mockCredential,
      id: OTHER_CREDENTIAL_ID,
    };

    const selectedCalendarRow = (externalId: string, credentialId: number) =>
      ({
        id: `selected-${credentialId}`,
        userId: 1,
        integration: "google_calendar",
        externalId,
        credentialId,
        eventTypeId: null,
      }) as any;

    /** One service per connection; each account reads only its own calendar, like Google does */
    const buildServicesPerConnection = (unreadableOwnCalendars: string[] = []) => {
      const accounts = [
        { credential: mockCredential, ownId: OWN_ID, busy: readableBusy },
        { credential: otherCredential, ownId: OTHER_ACCOUNT_ID, busy: otherAccountBusy },
      ];
      const requested: Record<number, string[]> = {};
      const services = new Map(
        accounts.map(({ credential, ownId, busy }) => {
          const service = BuildCalendarService(credential);
          vi.spyOn(service as any, "getFreeBusyResult").mockImplementation(async (args: any) => {
            const ids = (args as { items: { id: string }[] }).items.map(({ id }) => id);
            requested[credential.id] = ids;
            return {
              calendars: Object.fromEntries(
                ids.map((id) => [
                  id,
                  id === ownId && !unreadableOwnCalendars.includes(id)
                    ? { busy }
                    : { errors: notFound, busy: [] },
                ])
              ),
            };
          });
          return [credential.id, service] as const;
        })
      );
      setFullMockOAuthManagerRequest();
      getCalendarMock.mockImplementation(async (credential: { id: number }) => services.get(credential.id));
      return { requested };
    };

    const getBusyTimesOfBothConnections = async () => {
      const { getBusyCalendarTimes } = await import("@calcom/features/calendars/lib/CalendarManager");
      return getBusyCalendarTimes(
        [mockCredential, otherCredential],
        "2024-01-01T00:00:00Z",
        "2024-01-08T00:00:00Z",
        [
          selectedCalendarRow(OWN_ID, mockCredential.id),
          selectedCalendarRow(OTHER_ACCOUNT_ID, OTHER_CREDENTIAL_ID),
        ],
        "slots"
      );
    };

    test("returns the busy times of both accounts", async () => {
      buildServicesPerConnection();

      const result = await getBusyTimesOfBothConnections();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining(readableBusy[0]),
          expect.objectContaining(otherAccountBusy[0]),
        ])
      );
    });

    test("reports a failure when a calendar cannot be read by its own connection", async () => {
      buildServicesPerConnection([OTHER_ACCOUNT_ID]);

      const result = await getBusyTimesOfBothConnections();

      expect(result.success).toBe(false);
      expect(result.data).toEqual([expect.objectContaining({ source: "error-placeholder" })]);
    });
  });
});

describe("chunks of a range longer than 90 days", () => {
  const requestedRanges = () =>
    freebusyQueryMock.mock.calls.map(([{ requestBody }]) => ({
      timeMin: requestBody.timeMin,
      timeMax: requestBody.timeMax,
    }));

  test("ask Google for the whole range, without gaps, when the day count is a multiple of 90", async () => {
    const calendarService = buildService();
    mockFreeBusy();

    // 180 days and 23 hours: two whole 90-day chunks and a tail
    await calendarService.getAvailability({
      dateFrom: "2026-09-30T13:00:00Z",
      dateTo: "2027-03-30T12:00:00Z",
      selectedCalendars: [selectedCalendar(READABLE_ID)],
      mode: "slots",
      fallbackToPrimary: false,
    });

    const ranges = requestedRanges();
    expect(ranges[0].timeMin).toBe("2026-09-30T13:00:00.000Z");
    expect(ranges[ranges.length - 1].timeMax).toBe("2027-03-30T12:00:00.000Z");
    ranges.slice(1).forEach((range, i) => expect(range.timeMin).toBe(ranges[i].timeMax));
    ranges.forEach(({ timeMin, timeMax }) =>
      expect(new Date(timeMax).getTime() - new Date(timeMin).getTime()).toBeLessThanOrEqual(
        90 * 24 * 60 * 60 * 1000
      )
    );
  });
});
