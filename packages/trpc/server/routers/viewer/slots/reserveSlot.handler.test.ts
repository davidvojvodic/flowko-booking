import { describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { slotsRouter } from "./_router";
import { reserveSlotHandler } from "./reserveSlot.handler";

// Flowko (U8c, AV-2): slot reservation is switched off. An anonymous reserveSlot used to write a
// SelectedSlots row for any time range, and getSchedule then hid every overlapping slot of that host.

// Every Prisma method the old handler and removeSelectedSlotMark touched. None may be called now.
const buildPrismaStub = () => ({
  eventType: { findUnique: vi.fn().mockResolvedValue({ users: [{ id: 1 }], seatsPerTimeSlot: null }) },
  booking: { findFirst: vi.fn().mockResolvedValue(null) },
  selectedSlots: {
    upsert: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
});

const reserveInput = {
  eventTypeId: 1,
  // A whole year: the shape of the AV-2 attack
  slotUtcStartDate: new Date().toISOString(),
  slotUtcEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  _isDryRun: false,
};

const expectNothingTouched = (prismaStub: ReturnType<typeof buildPrismaStub>) => {
  expect(prismaStub.selectedSlots.upsert).not.toHaveBeenCalled();
  expect(prismaStub.selectedSlots.create).not.toHaveBeenCalled();
  expect(prismaStub.selectedSlots.deleteMany).not.toHaveBeenCalled();
  expect(prismaStub.eventType.findUnique).not.toHaveBeenCalled();
  expect(prismaStub.booking.findFirst).not.toHaveBeenCalled();
};

describe("reserveSlotHandler (reservation switched off)", () => {
  it("writes no SelectedSlots row and sets no cookie, but still returns a uid for the booker", async () => {
    const prismaStub = buildPrismaStub();
    const resStub = { setHeader: vi.fn() };

    const result = await reserveSlotHandler({
      ctx: { prisma: prismaStub as never, req: { cookies: {} } as never, res: resStub as never },
      input: reserveInput,
    });

    expect(typeof result.uid).toBe("string");
    expect(result.uid.length).toBeGreaterThan(0);
    expectNothingTouched(prismaStub);
    expect(resStub.setHeader).not.toHaveBeenCalled();
  });

  it("writes nothing through the public tRPC procedure either", async () => {
    const prismaStub = buildPrismaStub();
    const resStub = { setHeader: vi.fn() };
    const caller = createCallerFactory(slotsRouter)({
      prisma: prismaStub,
      req: { cookies: { uid: "attacker-uid" } },
      res: resStub,
    } as never);

    const result = await caller.reserveSlot(reserveInput);

    expect(typeof result.uid).toBe("string");
    expectNothingTouched(prismaStub);
    expect(resStub.setHeader).not.toHaveBeenCalled();
  });
});

describe("removeSelectedSlotMark (reservation switched off)", () => {
  it("deletes nothing, whether the uid comes from the input or the cookie", async () => {
    const prismaStub = buildPrismaStub();
    const caller = createCallerFactory(slotsRouter)({
      prisma: prismaStub,
      req: { cookies: { uid: "someone-elses-uid" } },
    } as never);

    await expect(caller.removeSelectedSlotMark({ uid: "another-uid" })).resolves.toBeUndefined();
    await expect(caller.removeSelectedSlotMark({ uid: null })).resolves.toBeUndefined();

    expect(prismaStub.selectedSlots.deleteMany).not.toHaveBeenCalled();
  });
});
