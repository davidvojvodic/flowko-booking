// Flowko U27 (G2): requestReschedule refuses a business booking (TRPCError FORBIDDEN flowko_business_booking)
// before it cancels it; an ordinary booking takes the same path as before (its first write is reached).
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { BookingStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestRescheduleHandler } from "./requestReschedule.handler";

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@calcom/features/bookings/repositories/BookingRepository");
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({
  businessBookingById: vi.fn(async (_db: unknown, id: number) => (id === 41 ? { bookingId: 41 } : null)),
  businessBookingByUid: vi.fn(async (_db: unknown, uid: string) =>
    uid === "business-uid" ? { bookingId: 41 } : null
  ),
  mirrorOfEventType: vi.fn(),
  nonOwnerMemberOf: vi.fn(),
}));

const STOP = new Error("first write reached");
const updateBookingStatus = vi.fn(async () => {
  throw STOP;
});

function bookingWith(id: number, uid: string) {
  return {
    id,
    uid,
    status: BookingStatus.ACCEPTED,
    userId: 101,
    user: { id: 101 },
    eventType: { id: 9, teamId: null },
    dynamicEventSlugRef: null,
    attendees: [],
    references: [],
  };
}

function requestReschedule(bookingUid: string) {
  return requestRescheduleHandler({
    ctx: { user: { id: 101, email: "ana@example.com" } } as never,
    input: { bookingUid },
    source: "WEBAPP",
  });
}

describe("requestReschedule and business bookings (Flowko U27 G2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BookingRepository).mockImplementation(function () {
      return {
        findByUidIncludeEventTypeAndReferences: vi.fn(async ({ bookingUid }: { bookingUid: string }) =>
          bookingUid === "business-uid" ? bookingWith(41, bookingUid) : bookingWith(42, bookingUid)
        ),
        updateBookingStatus,
      } as never;
    });
  });

  it("refuses a business booking with FORBIDDEN flowko_business_booking before any write", async () => {
    await expect(requestReschedule("business-uid")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "flowko_business_booking",
    });
    expect(updateBookingStatus).not.toHaveBeenCalled();
  });

  it("takes an ordinary booking down the usual path", async () => {
    await expect(requestReschedule("ordinary-uid")).rejects.toBe(STOP);
    expect(updateBookingStatus).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 42 }));
  });
});
