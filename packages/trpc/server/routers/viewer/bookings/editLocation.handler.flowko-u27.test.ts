// Flowko U27 (G2): editLocation refuses a business booking (TRPCError FORBIDDEN flowko_business_booking) before
// it loads the organizer or touches the calendar; an ordinary booking takes the same path as before.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findByIdOrThrow, updateLocation, updateLocationById } = vi.hoisted(() => ({
  findByIdOrThrow: vi.fn(),
  updateLocation: vi.fn(),
  updateLocationById: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({
  businessBookingById: vi.fn(async (_db: unknown, id: number) => (id === 41 ? { bookingId: 41 } : null)),
  businessBookingByUid: vi.fn(async () => null),
  mirrorOfEventType: vi.fn(),
  nonOwnerMemberOf: vi.fn(),
}));
vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: vi.fn(function UserRepository() {
    return { findByIdOrThrow };
  }),
}));
vi.mock("@calcom/features/bookings/lib/EventManager", () => ({
  default: vi.fn(function EventManager() {
    return { updateLocation };
  }),
}));
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({
  BookingRepository: vi.fn(function BookingRepository() {
    return { updateLocationById };
  }),
}));

import { editLocationHandler } from "./editLocation.handler";

const STOP = new Error("organizer load reached");

function editLocation(bookingId: number) {
  return editLocationHandler({
    ctx: {
      user: { id: 101, email: "ana@example.com", locale: "en" },
      booking: {
        id: bookingId,
        userId: 101,
        location: "inPerson",
        metadata: {},
        responses: {},
        references: [],
      },
    } as never,
    input: { bookingId, newLocation: "inPerson", credentialId: null } as never,
    actionSource: "WEBAPP",
  });
}

describe("editLocation and business bookings (Flowko U27 G2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByIdOrThrow.mockRejectedValue(STOP);
  });

  it("refuses a business booking with FORBIDDEN flowko_business_booking before anything else", async () => {
    await expect(editLocation(41)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "flowko_business_booking",
    });
    expect(findByIdOrThrow).not.toHaveBeenCalled();
    expect(updateLocation).not.toHaveBeenCalled();
    expect(updateLocationById).not.toHaveBeenCalled();
  });

  it("takes an ordinary booking down the usual path", async () => {
    await expect(editLocation(42)).rejects.toBe(STOP);
    expect(findByIdOrThrow).toHaveBeenCalledWith({ id: 101 });
  });
});
