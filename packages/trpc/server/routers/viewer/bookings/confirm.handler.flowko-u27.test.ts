// Flowko U27 (G2): confirm (also behind /api/link and /api/verify-booking-token) refuses a business booking
// (TRPCError FORBIDDEN flowko_business_booking) before any write; an ordinary booking takes the same path as before.
import { BookingAccessService } from "@calcom/features/bookings/services/BookingAccessService";
import { BookingStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueOrThrow, update } = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn(), update: vi.fn() }));

vi.mock("@calcom/prisma", () => ({
  default: { booking: { findUniqueOrThrow, update } },
  prisma: { booking: { findUniqueOrThrow, update } },
}));
vi.mock("@calcom/features/bookings/services/BookingAccessService");
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({
  businessBookingById: vi.fn(async (_db: unknown, id: number) => (id === 41 ? { bookingId: 41 } : null)),
  businessBookingByUid: vi.fn(async () => null),
  mirrorOfEventType: vi.fn(),
  nonOwnerMemberOf: vi.fn(),
}));

import { confirmHandler } from "./confirm.handler";

function confirm(bookingId: number, confirmed: boolean) {
  return confirmHandler({
    ctx: { user: { id: 101, email: "ana@example.com" } } as never,
    input: { bookingId, confirmed } as never,
  });
}

describe("confirm and business bookings (Flowko U27 G2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Unpaid with a payment row: confirming an ordinary booking writes at once (the earliest write).
    findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: number } }) => ({
      id: where.id,
      uid: `booking-${where.id}`,
      status: BookingStatus.PENDING,
      payment: [{ id: 1 }],
      paid: false,
      attendees: [],
      user: { id: 101 },
      userId: 101,
      eventType: null,
    }));
    update.mockResolvedValue({});
    vi.mocked(BookingAccessService).mockImplementation(function () {
      return { doesUserIdHaveAccessToBooking: vi.fn(async () => true) } as never;
    });
  });

  it.each([
    true,
    false,
  ])("refuses a business booking with FORBIDDEN flowko_business_booking (confirmed=%s) before any write", async (confirmed) => {
    await expect(confirm(41, confirmed)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "flowko_business_booking",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("still answers UNAUTHORIZED first to a user without access", async () => {
    vi.mocked(BookingAccessService).mockImplementation(function () {
      return { doesUserIdHaveAccessToBooking: vi.fn(async () => false) } as never;
    });
    await expect(confirm(41, true)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("takes an ordinary booking down the usual path", async () => {
    await expect(confirm(42, true)).resolves.toEqual({
      message: "Booking confirmed",
      status: BookingStatus.ACCEPTED,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 42 }, data: { status: BookingStatus.ACCEPTED } });
  });
});
