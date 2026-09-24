import prismock from "@calcom/testing/lib/__mocks__/prisma";
import {
  createBookingScenario,
  getDate,
  getGoogleCalendarCredential,
  mockCalendar,
  TestData,
  Timezones,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";

import { createCallerFactory } from "../../../trpc";
import { slotsRouter } from "./_router";

// Flowko (U8c, AV-5): the public getSchedule procedure ignores the internal/debug flags, so an
// anonymous visitor cannot compute a tenant's slots without their Google Calendar busy times.

const cleanup = async () => {
  await prismock.eventType.deleteMany();
  await prismock.user.deleteMany();
  await prismock.schedule.deleteMany();
  await prismock.selectedCalendar.deleteMany();
  await prismock.credential.deleteMany();
  await prismock.booking.deleteMany();
  await prismock.app.deleteMany();
  vi.useRealTimers();
};

const slotTimes = (schedule: { slots: Record<string, { time: string }[]> }, dateString: string) =>
  (schedule.slots[dateString] ?? []).map((slot) => slot.time);

describe("getSchedule internal flags from an anonymous caller", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("_bypassCalendarBusyTimes does not reveal slots the host's Google Calendar blocks", async () => {
    const { dateString: plus1DateString } = getDate({ dateIncrement: 1 });
    const { dateString: plus2DateString } = getDate({ dateIncrement: 2 });

    // IST work hours are 04:00-12:30 UTC; the host's own calendar blocks everything after 04:45
    mockCalendar("googlecalendar", {
      create: { uid: "MOCK_ID", iCalUID: "MOCKED_GOOGLE_CALENDAR_ICS_ID" },
      busySlots: [{ start: `${plus2DateString}T04:45:00.000Z`, end: `${plus2DateString}T23:00:00.000Z` }],
    });

    await createBookingScenario({
      eventTypes: [{ id: 1, slotInterval: 45, length: 45, users: [{ id: 101 }] }],
      users: [
        {
          ...TestData.users.example,
          id: 101,
          schedules: [TestData.schedules.IstWorkHours],
          credentials: [getGoogleCalendarCredential()],
          selectedCalendars: [TestData.selectedCalendars.google],
        },
      ],
      apps: [TestData.apps["google-calendar"]],
    });

    const input = {
      eventTypeId: 1,
      startTime: `${plus1DateString}T18:30:00.000Z`,
      endTime: `${plus2DateString}T18:29:59.999Z`,
      timeZone: Timezones["+5:30"],
      isTeamEvent: false,
    };
    const onlyFreeSlot = [`${plus2DateString}T04:00:00.000Z`];

    // Control: the flag does bypass the calendar when the service is called internally
    const internal = await getAvailableSlotsService().getAvailableSlots({
      input: { ...input, orgSlug: null, _bypassCalendarBusyTimes: true },
    });
    expect(slotTimes(internal, plus2DateString).length).toBeGreaterThan(1);

    // Through the public procedure the flags are dropped and the calendar still counts
    const caller = createCallerFactory(slotsRouter)({ req: { cookies: {} } } as never);
    const schedule = await caller.getSchedule({
      ...input,
      _bypassCalendarBusyTimes: true,
      _silentCalendarFailures: true,
      _enableTroubleshooter: true,
    });

    expect(slotTimes(schedule, plus2DateString)).toEqual(onlyFreeSlot);
    expect(schedule).not.toHaveProperty("troubleshooter");
  });
});
