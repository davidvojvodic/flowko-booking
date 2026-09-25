import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { describe, expect, it } from "vitest";
import type { TrpcSessionUser } from "../../../../types";
import { bulkUpdateToDefaultAvailabilityHandler } from "./bulkUpdateDefaultAvailability.handler";

const OWN_SCHEDULE = 10;
const OTHER_TENANTS_SCHEDULE = 50;

const ctx = {
  user: { id: 1, defaultScheduleId: OWN_SCHEDULE } as NonNullable<TrpcSessionUser>,
};

function schedules() {
  const all = [
    { id: OWN_SCHEDULE, userId: 1 },
    { id: OTHER_TENANTS_SCHEDULE, userId: 2 },
  ];
  prismaMock.schedule.findFirst.mockImplementation((async (args: {
    where: { id: number; userId: number };
  }) =>
    all.find((schedule) => schedule.id === args.where.id && schedule.userId === args.where.userId) ??
    null) as never);
  prismaMock.eventType.updateMany.mockResolvedValue({ count: 1 });
}

// Schedule ids are sequential. Binding another tenant's schedule to the caller's event types showed that
// tenant's working hours, date overrides and timezone in the caller's slots and availability.user
describe("bulkUpdateToDefaultAvailabilityHandler", () => {
  it("refuses another tenant's schedule", async () => {
    schedules();

    await expect(
      bulkUpdateToDefaultAvailabilityHandler({
        ctx,
        input: { eventTypeIds: [5], selectedDefaultScheduleId: OTHER_TENANTS_SCHEDULE },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(prismaMock.schedule.findFirst).toHaveBeenCalledWith({
      where: { id: OTHER_TENANTS_SCHEDULE, userId: 1 },
      select: { id: true },
    });
    expect(prismaMock.eventType.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a schedule id that does not exist the same way", async () => {
    schedules();

    await expect(
      bulkUpdateToDefaultAvailabilityHandler({
        ctx,
        input: { eventTypeIds: [5], selectedDefaultScheduleId: 999 },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(prismaMock.eventType.updateMany).not.toHaveBeenCalled();
  });

  it("binds the owner's own selected schedule to the owner's event types", async () => {
    schedules();

    await expect(
      bulkUpdateToDefaultAvailabilityHandler({
        ctx,
        input: { eventTypeIds: [5, 6], selectedDefaultScheduleId: OWN_SCHEDULE },
      })
    ).resolves.toEqual({ count: 1 });

    expect(prismaMock.eventType.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [5, 6] }, userId: 1 },
      data: { scheduleId: OWN_SCHEDULE },
    });
  });

  it("falls back to the owner's default schedule", async () => {
    schedules();

    await bulkUpdateToDefaultAvailabilityHandler({ ctx, input: { eventTypeIds: [5] } });

    expect(prismaMock.eventType.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [5] }, userId: 1 },
      data: { scheduleId: OWN_SCHEDULE },
    });
  });

  it("still answers BAD_REQUEST when there is no schedule at all", async () => {
    await expect(
      bulkUpdateToDefaultAvailabilityHandler({
        ctx: { user: { id: 1, defaultScheduleId: null } as NonNullable<TrpcSessionUser> },
        input: { eventTypeIds: [5] },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(prismaMock.eventType.updateMany).not.toHaveBeenCalled();
  });
});
