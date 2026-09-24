import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import handleCancelBooking from "@calcom/features/bookings/lib/handleCancelBooking";
import { HttpError } from "@calcom/lib/http-error";
import { createInMemoryRateLimiter } from "@calcom/lib/rateLimit";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

// Flowko: the real checkRateLimitAndThrowError, getIP and PiiHasher, driven by a real in-memory limiter with a
// fake clock (rateLimiter() itself always passes under vitest). Each test gets a fresh one.
const rateLimitState = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  limiter: undefined as undefined | ((helper: { identifier: string }) => Promise<unknown>),
}));

vi.mock("@calcom/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/rateLimit")>();
  return { ...actual, rateLimiter: () => rateLimitState.limiter };
});

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

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@calcom/features/bookings/lib/handleCancelBooking", () => ({
  default: vi.fn(),
}));

vi.mock("@calcom/web/lib/validateCsrfToken", () => ({
  validateCsrfToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("@lib/buildLegacyCtx", () => ({
  buildLegacyRequest: vi.fn(() => ({})),
}));

const mockGetServerSession = vi.mocked(getServerSession);
const mockHandleCancelBooking = vi.mocked(handleCancelBooking);

const CSRF_TOKEN = "a".repeat(64);

const cancelRequest = (ip: string) =>
  new Request("https://booking.example.com/api/cancel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ uid: "booking-uid", csrfToken: CSRF_TOKEN }),
  }) as unknown as NextRequest;

/** Resolves to the response status, or 429 when the rate limit refused the call. */
const cancel = async (ip = "198.51.100.1") => {
  try {
    const response = (await POST(cancelRequest(ip), { params: Promise.resolve({}) })) as unknown as {
      status: number;
    };
    return response.status;
  } catch (error) {
    if (error instanceof HttpError) return error.statusCode;
    throw error;
  }
};

const signedInAs = (id: number) =>
  mockGetServerSession.mockResolvedValue({ user: { id } } as Awaited<ReturnType<typeof getServerSession>>);

describe("POST /api/cancel rate limits", () => {
  beforeEach(() => {
    rateLimitState.now = 1_800_000_000_000;
    rateLimitState.limiter = createInMemoryRateLimiter({ now: () => rateLimitState.now });
    mockGetServerSession.mockReset();
    mockGetServerSession.mockResolvedValue(null);
    mockHandleCancelBooking.mockReset();
    mockHandleCancelBooking.mockResolvedValue({ success: true } as Awaited<
      ReturnType<typeof handleCancelBooking>
    >);
  });

  it("lets a signed-in host cancel 60 bookings a minute", async () => {
    signedInAs(1);
    for (let i = 0; i < 60; i++) {
      expect(await cancel()).toBe(200);
    }

    expect(await cancel()).toBe(429);
    expect(mockHandleCancelBooking).toHaveBeenCalledTimes(60);
  });

  it("counts a host's cancellations per user, not per IP", async () => {
    signedInAs(1);
    for (let i = 0; i < 60; i++) {
      expect(await cancel(`198.51.100.${i}`)).toBe(200);
    }

    expect(await cancel("198.51.100.200")).toBe(429);
  });

  it("gives each host their own 60", async () => {
    signedInAs(1);
    for (let i = 0; i < 60; i++) await cancel();
    expect(await cancel()).toBe(429);

    signedInAs(2);
    expect(await cancel()).toBe(200);
  });

  it("frees the host again after the minute", async () => {
    signedInAs(1);
    for (let i = 0; i < 60; i++) await cancel();
    expect(await cancel()).toBe(429);

    rateLimitState.now += 60_000;

    expect(await cancel()).toBe(200);
  });

  it("keeps anonymous callers at 10 a minute per IP", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await cancel("198.51.100.1")).toBe(200);
    }

    expect(await cancel("198.51.100.1")).toBe(429);
    expect(mockHandleCancelBooking).toHaveBeenCalledTimes(10);
    // Another IP has its own 10.
    expect(await cancel("198.51.100.2")).toBe(200);
  });

  it("passes the signed-in user to the cancellation, and -1 for anonymous callers", async () => {
    signedInAs(7);
    await cancel();
    expect(mockHandleCancelBooking).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 7 }));

    mockGetServerSession.mockResolvedValue(null);
    await cancel();
    expect(mockHandleCancelBooking).toHaveBeenLastCalledWith(expect.objectContaining({ userId: -1 }));
  });
});
