// Flowko U27 (G2): reportBooking refuses a business booking (TRPCError FORBIDDEN flowko_business_booking) before
// it records a report or cancels through handleCancelBooking; an ordinary booking takes the same path as before.
import { PrismaBookingReportRepository } from "@calcom/features/bookingReport/repositories/PrismaBookingReportRepository";
import handleCancelBooking from "@calcom/features/bookings/lib/handleCancelBooking";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { BookingAccessService } from "@calcom/features/bookings/services/BookingAccessService";
import { BookingReportReason } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportBookingHandler } from "./reportBooking.handler";

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@calcom/features/bookingReport/repositories/PrismaBookingReportRepository");
vi.mock("@calcom/features/bookings/lib/handleCancelBooking");
vi.mock("@calcom/features/bookings/repositories/BookingRepository");
vi.mock("@calcom/features/bookings/services/BookingAccessService");
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({
  businessBookingById: vi.fn(async () => null),
  businessBookingByUid: vi.fn(async (_db: unknown, uid: string) =>
    uid === "business-uid" ? { bookingId: 41 } : null
  ),
  mirrorOfEventType: vi.fn(),
  nonOwnerMemberOf: vi.fn(),
}));

const STOP = new Error("booking load reached");
const findByUidIncludeReport = vi.fn();
const createReport = vi.fn();

function report(bookingUid: string) {
  return reportBookingHandler({
    ctx: { user: { id: 101, email: "ana@example.com" } } as never,
    input: { bookingUid, reason: BookingReportReason.SPAM },
  });
}

describe("reportBooking and business bookings (Flowko U27 G2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByUidIncludeReport.mockRejectedValue(STOP);
    vi.mocked(BookingRepository).mockImplementation(function () {
      return { findByUidIncludeReport } as never;
    });
    vi.mocked(PrismaBookingReportRepository).mockImplementation(function () {
      return { createReport } as never;
    });
    vi.mocked(BookingAccessService).mockImplementation(function () {
      return { doesUserIdHaveAccessToBooking: vi.fn(async () => true) } as never;
    });
  });

  it("refuses a business booking with FORBIDDEN flowko_business_booking before any write", async () => {
    await expect(report("business-uid")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "flowko_business_booking",
    });
    expect(createReport).not.toHaveBeenCalled();
    expect(handleCancelBooking).not.toHaveBeenCalled();
  });

  it("takes an ordinary booking down the usual path", async () => {
    await expect(report("ordinary-uid")).rejects.toBe(STOP);
    expect(findByUidIncludeReport).toHaveBeenCalledWith({ bookingUid: "ordinary-uid" });
  });
});
