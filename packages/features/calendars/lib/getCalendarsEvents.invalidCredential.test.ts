import "@calcom/testing/lib/__mocks__/prisma";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SelectedCalendar } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

import getCalendarsEvents, {
  getCalendarsEventsWithTimezones,
  InvalidCalendarCredentialError,
} from "./getCalendarsEvents";

const mocks = vi.hoisted(() => ({
  getAvailability: vi.fn(),
  getAvailabilityWithTimeZones: vi.fn(),
  createdForCredentialIds: [] as number[],
}));

vi.mock("@calcom/app-store/calendar.services.generated", () => ({
  CalendarServiceMap: {
    googlecalendar: Promise.resolve({
      default: (credential: { id: number }) => {
        mocks.createdForCredentialIds.push(credential.id);
        return {
          getCredentialId: () => credential.id,
          getAvailability: mocks.getAvailability,
          getAvailabilityWithTimeZones: mocks.getAvailabilityWithTimeZones,
          listCalendars: vi.fn().mockResolvedValue([]),
        };
      },
    }),
  },
}));

const USER_ID = 808;
const OWNER = "owner@example.com";
const SHOP = "shop@example.com";

const googleCredential = (id: number, invalid: boolean): CredentialForCalendarService => ({
  id,
  type: "google_calendar",
  appId: "google-calendar",
  key: { access_token: `access-${id}`, refresh_token: `refresh-${id}` },
  userId: USER_ID,
  user: { email: OWNER },
  teamId: null,
  invalid,
  delegationCredentialId: null,
  delegatedTo: null,
  delegatedToId: null,
});

const selectedCalendar = (externalId: string, credentialId: number | null): SelectedCalendar => ({
  userId: USER_ID,
  integration: "google_calendar",
  externalId,
  credentialId,
});

const DATE_FROM = "2026-10-01T00:00:00Z";
const DATE_TO = "2026-10-02T00:00:00Z";

const readBoth = (credentials: CredentialForCalendarService[], selectedCalendars: SelectedCalendar[]) => [
  () => getCalendarsEvents(credentials, DATE_FROM, DATE_TO, selectedCalendars, "slots"),
  () => getCalendarsEventsWithTimezones(credentials, DATE_FROM, DATE_TO, selectedCalendars),
];

describe("getCalendarsEvents with an invalid credential (Flowko: fail closed)", () => {
  beforeEach(() => {
    mocks.getAvailability.mockReset().mockResolvedValue([]);
    mocks.getAvailabilityWithTimeZones.mockReset().mockResolvedValue([]);
    mocks.createdForCredentialIds.length = 0;
  });

  it("fails the whole read when the host still checks a calendar of the invalid credential", async () => {
    const credentials = [googleCredential(1, true)];
    const selectedCalendars = [selectedCalendar(OWNER, 1)];

    for (const read of readBoth(credentials, selectedCalendars)) {
      await expect(read()).rejects.toBeInstanceOf(InvalidCalendarCredentialError);
    }
    // Nothing is asked of Google: the answer would not be complete anyway
    expect(mocks.getAvailability).not.toHaveBeenCalled();
    expect(mocks.getAvailabilityWithTimeZones).not.toHaveBeenCalled();
  });

  it("fails even when another, valid connection is read fine", async () => {
    const credentials = [googleCredential(1, true), googleCredential(2, false)];
    const selectedCalendars = [selectedCalendar(OWNER, 1), selectedCalendar(SHOP, 2)];

    for (const read of readBoth(credentials, selectedCalendars)) {
      await expect(read()).rejects.toBeInstanceOf(InvalidCalendarCredentialError);
    }
  });

  it("names the credential and a count, never a calendar id", async () => {
    const error = await getCalendarsEvents(
      [googleCredential(7, true)],
      DATE_FROM,
      DATE_TO,
      [selectedCalendar(OWNER, 7), selectedCalendar(SHOP, 7)],
      "slots"
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidCalendarCredentialError);
    const { message, credentialIds, selectedCalendarCount } = error as InvalidCalendarCredentialError;
    expect(credentialIds).toEqual([7]);
    expect(selectedCalendarCount).toBe(2);
    expect(message).toContain("7");
    expect(message).not.toContain(OWNER);
    expect(message).not.toContain(SHOP);
  });

  it("still skips an invalid credential whose calendars are no longer checked", async () => {
    const credentials = [googleCredential(1, true), googleCredential(2, false)];
    const selectedCalendars = [selectedCalendar(SHOP, 2)];

    const events = await getCalendarsEvents(credentials, DATE_FROM, DATE_TO, selectedCalendars, "slots");
    const eventsWithTimeZones = await getCalendarsEventsWithTimezones(
      credentials,
      DATE_FROM,
      DATE_TO,
      selectedCalendars
    );

    expect(events).toEqual([[]]);
    expect(eventsWithTimeZones).toEqual([[]]);
    // Only the valid connection is built and asked
    expect(mocks.createdForCredentialIds.every((id) => id === 2)).toBe(true);
    expect(mocks.getAvailability).toHaveBeenCalledTimes(1);
    expect(mocks.getAvailabilityWithTimeZones).toHaveBeenCalledTimes(1);
  });

  it("still skips an invalid credential when nothing is selected at all", async () => {
    for (const read of readBoth([googleCredential(1, true)], [])) {
      await expect(read()).resolves.toEqual([]);
    }
  });

  it("fails on a selected calendar without a credential when no valid connection of its kind reads it", async () => {
    const credentials = [googleCredential(1, true)];
    const selectedCalendars = [selectedCalendar(OWNER, null)];

    for (const read of readBoth(credentials, selectedCalendars)) {
      await expect(read()).rejects.toBeInstanceOf(InvalidCalendarCredentialError);
    }
  });

  it("leaves a selected calendar without a credential to a valid connection of its kind", async () => {
    // The valid connection is asked for it (Google's connection fails closed on a calendar it cannot read)
    const credentials = [googleCredential(1, true), googleCredential(2, false)];
    const selectedCalendars = [selectedCalendar(OWNER, null)];

    await expect(
      getCalendarsEvents(credentials, DATE_FROM, DATE_TO, selectedCalendars, "slots")
    ).resolves.toEqual([[]]);
    expect(mocks.getAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCalendars: [selectedCalendar(OWNER, null)] })
    );
  });

  it("makes getBusyCalendarTimes report a failure, so getBusyTimes withholds the slots", async () => {
    const { getBusyCalendarTimes } = await import("./CalendarManager");

    const result = await getBusyCalendarTimes(
      [googleCredential(1, true)],
      DATE_FROM,
      DATE_TO,
      [selectedCalendar(OWNER, 1)],
      "slots"
    );

    expect(result.success).toBe(false);
    expect(result.data).toEqual([expect.objectContaining({ source: "error-placeholder" })]);
  });

  it("does not count a selected calendar of another kind of calendar app", async () => {
    const credentials = [googleCredential(1, true)];
    const selectedCalendars: SelectedCalendar[] = [
      { userId: USER_ID, integration: "office365_calendar", externalId: "x", credentialId: null },
    ];

    await expect(
      getCalendarsEvents(credentials, DATE_FROM, DATE_TO, selectedCalendars, "slots")
    ).resolves.toEqual([]);
  });
});
