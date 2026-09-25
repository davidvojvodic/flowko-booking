import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAvailableHandler } from "./isAvailable.handler";

const mocks = vi.hoisted(() => ({
  findByIdMinimal: vi.fn(),
  findManyReservedByOthers: vi.fn(),
}));

vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository", () => ({
  EventTypeRepository: vi.fn().mockImplementation(function () {
    return { findByIdMinimal: mocks.findByIdMinimal };
  }),
}));

vi.mock("@calcom/features/selectedSlots/repositories/PrismaSelectedSlotRepository", () => ({
  PrismaSelectedSlotRepository: vi.fn().mockImplementation(function () {
    return { findManyReservedByOthers: mocks.findManyReservedByOthers };
  }),
}));

describe("isAvailableHandler (reservation switched off)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByIdMinimal.mockResolvedValue({ id: 1, minimumBookingNotice: 0 });
  });

  // Flowko (U8c, AV-2): another uid's SelectedSlots row is neither read nor reported
  it("ignores a slot reserved by another uid", async () => {
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const slot = {
      utcStartIso: start.toISOString(),
      utcEndIso: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
    };
    mocks.findManyReservedByOthers.mockResolvedValue([
      { slotUtcStartDate: new Date(slot.utcStartIso), slotUtcEndDate: new Date(slot.utcEndIso) },
    ]);

    const result = await isAvailableHandler({
      ctx: { prisma: {} as never, req: { cookies: { uid: "booker-uid" } } as never },
      input: { slots: [slot], eventTypeId: 1 },
    });

    expect(mocks.findManyReservedByOthers).not.toHaveBeenCalled();
    expect(result.slots).toEqual([{ ...slot, status: "available" }]);
  });

  it("still reports a slot in the past", async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const slot = {
      utcStartIso: start.toISOString(),
      utcEndIso: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
    };

    const result = await isAvailableHandler({
      ctx: { prisma: {} as never, req: { cookies: {} } as never },
      input: { slots: [slot], eventTypeId: 1 },
    });

    expect(result.slots).toEqual([{ ...slot, status: "slotInPast" }]);
  });

  it("answers 404 for an unknown event type", async () => {
    mocks.findByIdMinimal.mockResolvedValue(null);

    await expect(
      isAvailableHandler({
        ctx: { prisma: {} as never },
        input: { slots: [], eventTypeId: 999 },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
