import { describe, expect, it, vi } from "vitest";

import { isBookingsV3Enabled } from "./flowkoBookingsV3";

function prismaWith(row: { enabled: boolean } | null) {
  const findFirst = vi.fn().mockResolvedValue(row);
  return { prisma: { userFeatures: { findFirst } }, findFirst };
}

describe("isBookingsV3Enabled (Flowko U19: calendar view on by default)", () => {
  it("is on when the account has no explicit row", async () => {
    const { prisma, findFirst } = prismaWith(null);
    await expect(isBookingsV3Enabled(prisma, 7)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 7, featureId: "bookings-v3" },
      select: { enabled: true },
    });
  });

  it("is off when the account was switched off explicitly", async () => {
    const { prisma } = prismaWith({ enabled: false });
    await expect(isBookingsV3Enabled(prisma, 7)).resolves.toBe(false);
  });

  it("is on when the account was switched on explicitly", async () => {
    const { prisma } = prismaWith({ enabled: true });
    await expect(isBookingsV3Enabled(prisma, 7)).resolves.toBe(true);
  });
});
