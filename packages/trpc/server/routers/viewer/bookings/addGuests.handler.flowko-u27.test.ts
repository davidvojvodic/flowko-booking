// Flowko U27 (G2): addGuests refuses a business booking (TRPCError FORBIDDEN flowko_business_booking) before it
// loads the organizer or adds anyone; an ordinary booking takes the same path as before.
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUniqueOrThrow } = vi.hoisted(() => ({ userFindUniqueOrThrow: vi.fn() }));

vi.mock("@calcom/prisma", () => ({
  default: { user: { findUniqueOrThrow: userFindUniqueOrThrow } },
  prisma: { user: { findUniqueOrThrow: userFindUniqueOrThrow } },
}));
vi.mock("@calcom/features/bookings/repositories/BookingRepository");
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({
  businessBookingById: vi.fn(async (_db: unknown, id: number) => (id === 41 ? { bookingId: 41 } : null)),
  businessBookingByUid: vi.fn(async () => null),
  mirrorOfEventType: vi.fn(),
  nonOwnerMemberOf: vi.fn(),
}));

import { addGuestsHandler } from "./addGuests.handler";

const STOP = new Error("organizer load reached");
const updateBookingAttendees = vi.fn();

function addGuests(bookingId: number) {
  return addGuestsHandler({
    ctx: { user: { id: 101, email: "ana@example.com", organizationId: null, uuid: "u" } },
    input: { bookingId, guests: [{ email: "guest@example.com" }] },
    actionSource: "WEBAPP",
  });
}

describe("addGuests and business bookings (Flowko U27 G2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueOrThrow.mockRejectedValue(STOP);
    vi.mocked(BookingRepository).mockImplementation(function () {
      return {
        findByIdIncludeDestinationCalendar: vi.fn(async (id: number) => ({
          id,
          uid: `booking-${id}`,
          userId: 101,
          user: { id: 101 },
          attendees: [],
          eventType: null,
        })),
        updateBookingAttendees,
      } as never;
    });
  });

  it("refuses a business booking with FORBIDDEN flowko_business_booking before any write", async () => {
    await expect(addGuests(41)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "flowko_business_booking",
    });
    expect(userFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(updateBookingAttendees).not.toHaveBeenCalled();
  });

  it("still refuses an outsider with the usual permission error first", async () => {
    await expect(
      addGuestsHandler({
        ctx: { user: { id: 999, email: "other@example.com", organizationId: null, uuid: "u" } },
        input: { bookingId: 41, guests: [{ email: "guest@example.com" }] },
        actionSource: "WEBAPP",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "you_do_not_have_permission" });
  });

  it("takes an ordinary booking down the usual path", async () => {
    await expect(addGuests(42)).rejects.toBe(STOP);
    expect(userFindUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 101 } }));
  });
});
