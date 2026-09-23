import type { Logger } from "tslog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import dayjs from "@calcom/dayjs";
import { ErrorCode } from "@calcom/lib/errorCodes";

import { ensureAvailableUsers } from "./ensureAvailableUsers";

const { getUsersAvailability } = vi.hoisted(() => ({ getUsersAvailability: vi.fn() }));

vi.mock("@calcom/features/di/containers/GetUserAvailability", () => ({
  getUserAvailabilityService: () => ({ getUsersAvailability }),
}));

vi.mock("@calcom/features/di/containers/BusyTimes", () => ({
  getBusyTimesService: () => ({ getBusyTimesForLimitChecks: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@calcom/lib/sentryWrapper", () => ({
  withReporting: (fn: Function) => fn,
}));

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));

type EventTypeArg = Parameters<typeof ensureAvailableUsers>[0];
type InputArg = Parameters<typeof ensureAvailableUsers>[1];

const HOST_CALENDAR_ID = "salon.owner@gmail.com";

const eventType = {
  id: 1,
  users: [{ id: 101, username: "salon", isFixed: false }],
  bookingLimits: null,
  durationLimits: null,
  restrictionScheduleId: null,
  beforeEventBuffer: 0,
  afterEventBuffer: 0,
} as unknown as EventTypeArg;

/** Shaped like BookingRepository.findOriginalRescheduledBooking's result */
const originalRescheduledBooking = {
  id: 7,
  uid: "booking-uid-7",
  userId: 101,
  status: "ACCEPTED",
  title: "Striženje med Janez Novak in Salon",
  description: "Prosim za krajšo pričesko",
  startTime: new Date("2026-10-01T08:00:00.000Z"),
  endTime: new Date("2026-10-01T09:00:00.000Z"),
  location: "Trubarjeva 5, Ljubljana",
  responses: { name: "Janez Novak", email: "janez@example.si", attendeePhoneNumber: "+38640123456" },
  metadata: { note: "Janez Novak" },
  attendees: [
    {
      name: "Janez Novak",
      email: "janez@example.si",
      phoneNumber: "+38640123456",
      timeZone: "Europe/Ljubljana",
    },
  ],
  user: {
    id: 101,
    name: "Salon Owner",
    username: "salon",
    email: "owner@salon.si",
    destinationCalendar: { externalId: HOST_CALENDAR_ID, primaryEmail: HOST_CALENDAR_ID },
    credentials: [{ id: 5, type: "google_calendar", key: { refresh_token: "secret-refresh-token" } }],
  },
  destinationCalendar: { externalId: HOST_CALENDAR_ID, primaryEmail: HOST_CALENDAR_ID },
  references: [{ uid: "google-event-id", externalCalendarId: HOST_CALENDAR_ID }],
  payment: [{ uid: "payment-uid", data: { customerEmail: "janez@example.si" } }],
};

const input = {
  dateFrom: "2026-10-02T08:00:00.000Z",
  dateTo: "2026-10-02T09:00:00.000Z",
  timeZone: "Europe/Ljubljana",
  originalRescheduledBooking,
} as unknown as InputArg;

const createLogger = () => {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return { logger, asLogger: logger as unknown as Logger<unknown> };
};

const expectNoBookerOrHostDetails = (logged: string) => {
  for (const value of [
    "janez@example.si",
    "Janez Novak",
    "+38640123456",
    "Striženje",
    "Prosim za krajšo pričesko",
    "Trubarjeva",
    HOST_CALENDAR_ID,
    "owner@salon.si",
    "secret-refresh-token",
  ]) {
    expect(logged).not.toContain(value);
  }
};

describe("ensureAvailableUsers logging", () => {
  beforeEach(() => {
    getUsersAvailability.mockReset();
  });

  it("logs only the original booking's ids when a reschedule finds no availability", async () => {
    getUsersAvailability.mockResolvedValue([{ oooExcludedDateRanges: [], busy: [] }]);
    const { logger, asLogger } = createLogger();

    await expect(ensureAvailableUsers(eventType, input, asLogger)).rejects.toThrow(
      ErrorCode.NoAvailableUsersFound
    );

    // "User 101 does not have availability" and "No available users found."
    expect(logger.error).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain("booking-uid-7");
    expectNoBookerOrHostDetails(logged);
  });

  it("logs only the original booking's ids when the slot is outside the host's hours", async () => {
    getUsersAvailability.mockResolvedValue([
      {
        oooExcludedDateRanges: [
          { start: dayjs("2026-10-02T12:00:00.000Z"), end: dayjs("2026-10-02T13:00:00.000Z") },
        ],
        busy: [],
      },
    ]);
    const { logger, asLogger } = createLogger();

    await expect(ensureAvailableUsers(eventType, input, asLogger)).rejects.toThrow(
      ErrorCode.NoAvailableUsersFound
    );

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain("No date range for booking.");
    expect(logged).toContain("booking-uid-7");
    expectNoBookerOrHostDetails(logged);
  });
});
