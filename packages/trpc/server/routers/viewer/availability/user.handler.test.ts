import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import dayjs from "@calcom/dayjs";

import type { TrpcSessionUser } from "../../../types";
import { userHandler } from "./user.handler";
import { ZUserInputSchema } from "./user.schema";
import type { TUserInputSchema } from "./user.schema";

const { findUsersForAvailabilityCheck, getAvailability } = vi.hoisted(() => ({
  findUsersForAvailabilityCheck: vi.fn(),
  getAvailability: vi.fn(),
}));

vi.mock("@calcom/features/availability/lib/findUsersForAvailabilityCheck", () => ({
  findUsersForAvailabilityCheck,
}));

vi.mock("@calcom/features/di/containers/GetUserAvailability", () => ({
  getUserAvailabilityService: () => ({
    getUserAvailabilityIncludingBusyTimesFromLimits: getAvailability,
  }),
}));

const owner = { id: 1, username: "salon", role: "USER" } as unknown as NonNullable<TrpcSessionUser>;
const admin = { id: 9, username: "flowko", role: "ADMIN" } as unknown as NonNullable<TrpcSessionUser>;

const range = { dateFrom: dayjs("2026-09-24T00:00:00Z"), dateTo: dayjs("2026-09-24T23:59:59Z") };

describe("availability.user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUsersForAvailabilityCheck.mockResolvedValue({ id: 1, username: "salon" });
    getAvailability.mockResolvedValue({ busy: [] });
  });

  // Every client business is a separate user on this instance
  it("refuses another user's availability", async () => {
    await expect(
      userHandler({ ctx: { user: owner }, input: { username: "agency", ...range } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(findUsersForAvailabilityCheck).not.toHaveBeenCalled();
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("returns the caller's own availability, looked up by their id", async () => {
    const input: TUserInputSchema = { username: "salon", withSource: true, ...range };

    await expect(userHandler({ ctx: { user: owner }, input })).resolves.toEqual({ busy: [] });

    expect(findUsersForAvailabilityCheck).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(getAvailability).toHaveBeenCalledWith(
      { ...input, returnDateOverrides: true, bypassBusyCalendarTimes: false },
      { user: { id: 1, username: "salon" } }
    );
  });

  it("refuses an event type the caller has no access to", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue(null);

    await expect(
      userHandler({ ctx: { user: owner }, input: { username: "salon", eventTypeId: 42, ...range } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(prismaMock.eventType.findUnique).toHaveBeenCalledWith({
      where: {
        id: 42,
        OR: [{ userId: 1 }, { hosts: { some: { userId: 1 } } }, { users: { some: { id: 1 } } }],
      },
    });
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("uses the caller's own event type", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue({ id: 7, userId: 1 } as never);

    await userHandler({ ctx: { user: owner }, input: { username: "salon", eventTypeId: 7, ...range } });

    expect(getAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypeId: 7, bypassBusyCalendarTimes: false }),
      { user: { id: 1, username: "salon" } }
    );
  });

  it("lets an admin read any user's availability", async () => {
    findUsersForAvailabilityCheck.mockResolvedValue({ id: 2, username: "agency" });

    await userHandler({ ctx: { user: admin }, input: { username: "agency", eventTypeId: 42, ...range } });

    expect(prismaMock.eventType.findUnique).not.toHaveBeenCalled();
    expect(findUsersForAvailabilityCheck).toHaveBeenCalledWith({ where: { username: "agency" } });
    expect(getAvailability).toHaveBeenCalledTimes(1);
  });

  it("does not let the input switch off the calendar busy times", async () => {
    const input = { username: "salon", ...range, bypassBusyCalendarTimes: true, returnDateOverrides: false };

    await userHandler({ ctx: { user: owner }, input: input as unknown as TUserInputSchema });

    expect(getAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ bypassBusyCalendarTimes: false, returnDateOverrides: true }),
      expect.anything()
    );
  });

  it("strips options the input schema does not declare", () => {
    const parsed = ZUserInputSchema.parse({
      username: "salon",
      dateFrom: "2026-09-24T00:00:00Z",
      dateTo: "2026-09-24T23:59:59Z",
      bypassBusyCalendarTimes: true,
      silentlyHandleCalendarFailures: true,
      mode: "none",
    });

    expect(Object.keys(parsed).sort()).toEqual(["dateFrom", "dateTo", "username"]);
  });
});
