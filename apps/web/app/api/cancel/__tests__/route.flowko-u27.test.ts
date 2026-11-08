// Flowko U27 (W8): /api/cancel diverts a business booking to Flowko's step-aware customer cancel. CSRF and the
// rate limit still come first; a FlowkoBusinessError becomes 400 { success: false, message: <code> } (the cancel
// form shows data.message); an ordinary uid goes to handleCancelBooking as before.
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import handleCancelBooking from "@calcom/features/bookings/lib/handleCancelBooking";
import { cancelBusinessBookingAsCustomer } from "@calcom/features/flowkoBusiness/bookingChange";
import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";
import { businessBookingByUid } from "@calcom/features/flowkoBusiness/mirror";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { validateCsrfToken } from "@calcom/web/lib/validateCsrfToken";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (handler: (req: NextRequest) => Promise<Response>) =>
    (req: NextRequest, _context: { params: Promise<Record<string, string>> }) =>
      handler(req),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body })),
  },
}));
vi.mock("@calcom/prisma", () => ({ default: { tag: "global-prisma" }, prisma: { tag: "global-prisma" } }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn() }));
vi.mock("@calcom/features/bookings/lib/handleCancelBooking", () => ({ default: vi.fn() }));
vi.mock("@calcom/features/flowkoBusiness/mirror", () => ({ businessBookingByUid: vi.fn() }));
vi.mock("@calcom/features/flowkoBusiness/bookingChange", () => ({
  cancelBusinessBookingAsCustomer: vi.fn(),
}));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/web/lib/validateCsrfToken", () => ({ validateCsrfToken: vi.fn() }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: vi.fn(() => ({})) }));

const mockGetServerSession = vi.mocked(getServerSession);
const mockHandleCancelBooking = vi.mocked(handleCancelBooking);
const mockBusinessBookingByUid = vi.mocked(businessBookingByUid);
const mockCustomerCancel = vi.mocked(cancelBusinessBookingAsCustomer);
const mockRateLimit = vi.mocked(checkRateLimitAndThrowError);
const mockCsrf = vi.mocked(validateCsrfToken);

const BUSINESS_UID = "business-uid";
const businessRef = {
  bookingId: 41,
  uid: BUSINESS_UID,
  businessId: 1,
  businessSlug: "salon-a",
  memberId: 3,
  eventTypeId: 9,
};

async function cancel(uid: string, extra: Record<string, unknown> = {}) {
  const request = new Request("https://booking.example.com/api/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uid, csrfToken: "a".repeat(64), ...extra }),
  }) as unknown as NextRequest;
  return (await POST(request, { params: Promise.resolve({}) })) as unknown as {
    status: number;
    body: unknown;
  };
}

const signedInAs = (id: number) =>
  mockGetServerSession.mockResolvedValue({ user: { id } } as Awaited<ReturnType<typeof getServerSession>>);

describe("POST /api/cancel diverts business bookings (Flowko U27 W8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
    mockCsrf.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(undefined as never);
    mockBusinessBookingByUid.mockImplementation(async (_db, uid) =>
      uid === BUSINESS_UID ? businessRef : null
    );
    mockCustomerCancel.mockResolvedValue({ status: "cancelled" });
    mockHandleCancelBooking.mockResolvedValue({ success: true } as Awaited<
      ReturnType<typeof handleCancelBooking>
    >);
  });

  it("cancels a business booking through the customer cancel with the session user, not Cal's cancel", async () => {
    signedInAs(7);

    const response = await cancel(BUSINESS_UID, { cancellationReason: "Zbolela sem" });

    expect(mockCustomerCancel).toHaveBeenCalledTimes(1);
    const [db, input, now] = mockCustomerCancel.mock.calls[0];
    expect(db).toEqual({ tag: "global-prisma" });
    expect(input).toEqual({ uid: BUSINESS_UID, reason: "Zbolela sem", sessionUserId: 7 });
    expect(now).toBeInstanceOf(Date);
    expect(mockHandleCancelBooking).not.toHaveBeenCalled();
    expect(response).toEqual({
      status: 200,
      body: {
        success: true,
        message: "Booking successfully cancelled.",
        onlyRemovedAttendee: false,
        bookingId: 41,
        bookingUid: BUSINESS_UID,
        isPlatformManagedUserBooking: false,
      },
    });
  });

  it("passes a null session user for an anonymous caller", async () => {
    const response = await cancel(BUSINESS_UID);

    expect(mockCustomerCancel).toHaveBeenCalledWith(
      expect.anything(),
      { uid: BUSINESS_UID, reason: null, sessionUserId: null },
      expect.any(Date)
    );
    expect(mockHandleCancelBooking).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it.each([
    "booking_not_active",
    "forbidden",
    "bad_booking",
  ] as const)("answers a FlowkoBusinessError %s with 400 { success: false, message: code }", async (code) => {
    mockCustomerCancel.mockRejectedValue(new FlowkoBusinessError(code));

    const response = await cancel(BUSINESS_UID);

    expect(response).toEqual({ status: 400, body: { success: false, message: code } });
    expect(mockHandleCancelBooking).not.toHaveBeenCalled();
  });

  it("lets any other error through (no 400 for an unexpected failure)", async () => {
    mockCustomerCancel.mockRejectedValue(new Error("db down"));

    await expect(cancel(BUSINESS_UID)).rejects.toThrow("db down");
  });

  it("checks CSRF and the rate limit before it looks the booking up", async () => {
    await cancel(BUSINESS_UID);
    const lookup = mockBusinessBookingByUid.mock.invocationCallOrder[0];
    expect(mockCsrf.mock.invocationCallOrder[0]).toBeLessThan(lookup);
    expect(mockRateLimit.mock.invocationCallOrder[0]).toBeLessThan(lookup);

    vi.clearAllMocks();
    const refused = { status: 403, body: { message: "csrf" } };
    mockCsrf.mockResolvedValue(refused as never);
    expect(await cancel(BUSINESS_UID)).toBe(refused);
    expect(mockBusinessBookingByUid).not.toHaveBeenCalled();
    expect(mockCustomerCancel).not.toHaveBeenCalled();
  });

  it("sends an ordinary uid to handleCancelBooking as before", async () => {
    signedInAs(7);

    const response = await cancel("ordinary-uid");

    expect(mockCustomerCancel).not.toHaveBeenCalled();
    expect(mockHandleCancelBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingData: expect.objectContaining({ uid: "ordinary-uid" }), userId: 7 })
    );
    expect(response.status).toBe(200);
  });
});
