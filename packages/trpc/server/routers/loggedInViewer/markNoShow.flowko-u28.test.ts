// Flowko U28 (D4): Cal's markNoShow refuses a business booking (TRPCError FORBIDDEN flowko_business_booking) before
// any write; an ordinary booking takes the same path as before.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@calcom/features/handleMarkNoShow", () => ({ handleMarkAttendeesAndHostNoShow: m.handle }));
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({
  businessBookingById: vi.fn(async () => null),
  businessBookingByUid: vi.fn(async (_db: unknown, uid: string) =>
    uid === "business-uid" ? { bookingId: 41 } : null
  ),
  mirrorOfEventType: vi.fn(),
  nonOwnerMemberOf: vi.fn(),
}));

import { markNoShow } from "./markNoShow.handler";

function run(bookingUid: string) {
  return markNoShow({
    ctx: { user: { id: 101, locale: "en" }, session: {} } as never,
    input: { bookingUid, attendees: [{ email: "a@example.com", noShow: true }] } as never,
  });
}

describe("markNoShow and business bookings (Flowko U28 D4)", () => {
  beforeEach(() => {
    m.handle.mockReset();
    m.handle.mockResolvedValue({ message: "ok" });
  });

  it("refuses a business booking with FORBIDDEN flowko_business_booking before any write", async () => {
    await expect(run("business-uid")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "flowko_business_booking",
    });
    expect(m.handle).not.toHaveBeenCalled();
  });

  it("an ordinary booking takes the unchanged path", async () => {
    await expect(run("ordinary-uid")).resolves.toEqual({ message: "ok" });
    expect(m.handle).toHaveBeenCalledWith({
      bookingUid: "ordinary-uid",
      attendees: [{ email: "a@example.com", noShow: true }],
      noShowHost: undefined,
      userId: 101,
      locale: "en",
    });
  });
});
