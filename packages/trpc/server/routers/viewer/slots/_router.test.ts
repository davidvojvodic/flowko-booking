import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { slotsRouter } from "./_router";

const mocks = vi.hoisted(() => ({
  getScheduleHandler: vi.fn(),
}));

vi.mock("./getSchedule.handler", () => ({ getScheduleHandler: mocks.getScheduleHandler }));

// An anonymous public booker: no session, only a request
const anonymousCaller = () => createCallerFactory(slotsRouter)({ req: { cookies: {} } } as never);

const baseInput = {
  eventTypeId: 1,
  startTime: "2026-10-01T00:00:00.000Z",
  endTime: "2026-10-31T23:59:59.000Z",
  timeZone: "Europe/Ljubljana",
  isTeamEvent: false,
};

describe("slotsRouter.getSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getScheduleHandler.mockResolvedValue({ slots: {} });
  });

  // Flowko (U8c, AV-5): internal/debug flags never reach the slot computation from the public procedure
  it("strips the internal flags before the handler sees the input", async () => {
    await anonymousCaller().getSchedule({
      ...baseInput,
      _enableTroubleshooter: true,
      _bypassCalendarBusyTimes: true,
      _silentCalendarFailures: true,
    });

    expect(mocks.getScheduleHandler).toHaveBeenCalledTimes(1);
    const { input } = mocks.getScheduleHandler.mock.calls[0][0];
    expect(input).not.toHaveProperty("_enableTroubleshooter");
    expect(input).not.toHaveProperty("_bypassCalendarBusyTimes");
    expect(input).not.toHaveProperty("_silentCalendarFailures");
  });

  it("passes every booker field through unchanged", async () => {
    await anonymousCaller().getSchedule({
      ...baseInput,
      duration: "30",
      rescheduleUid: "booking-uid",
      _bypassCalendarBusyTimes: true,
    });

    const { input } = mocks.getScheduleHandler.mock.calls[0][0];
    expect(input).toEqual({
      ...baseInput,
      duration: 30,
      rescheduleUid: "booking-uid",
      orgSlug: null,
    });
  });
});
