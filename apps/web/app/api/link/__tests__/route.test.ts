import { LINK_TOKEN_KEY_LABEL, symmetricEncrypt, symmetricEncryptAuthenticated } from "@calcom/lib/crypto";
import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";
import type { NextRequest } from "next/server";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmHandler = confirmHandler as unknown as Mock<typeof confirmHandler>;

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
    redirect: vi.fn((url: string | URL, init?: { status?: number }) => {
      const location = typeof url === "string" ? url : url.toString();
      return {
        status: init?.status ?? 302,
        headers: {
          get: (name: string) => (name.toLowerCase() === "location" ? location : null),
        },
      } as unknown as Response;
    }),
  },
}));

// Two tenants: booking-a belongs to user 1 (organizer A), booking-b to user 2 (organizer B).
const BOOKINGS: Record<string, { id: number; uid: string; userId: number | null; recurringEventId: null }> = {
  "booking-a": { id: 11, uid: "booking-a", userId: 1, recurringEventId: null },
  "booking-b": { id: 22, uid: "booking-b", userId: 2, recurringEventId: null },
  "booking-orphan": { id: 33, uid: "booking-orphan", userId: null, recurringEventId: null },
};
const USERS: Record<number, Record<string, unknown>> = {
  1: {
    id: 1,
    uuid: "user-a-uuid",
    email: "a@example.com",
    username: "organizer-a",
    role: "USER",
    destinationCalendar: null,
  },
  2: {
    id: 2,
    uuid: "user-b-uuid",
    email: "b@example.com",
    username: "organizer-b",
    role: "USER",
    destinationCalendar: null,
  },
};

vi.mock("@calcom/prisma", () => {
  const mockPrismaObj = {
    booking: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  return {
    default: mockPrismaObj,
    prisma: mockPrismaObj,
  };
});

vi.mock("@calcom/trpc/server/routers/viewer/bookings/confirm.handler", () => ({
  confirmHandler: vi.fn(),
}));

vi.mock("@calcom/lib/tracing/factory", () => ({
  distributedTracing: {
    createTrace: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("@calcom/features/booking-audit/lib/makeActor", () => ({
  makeUserActor: vi.fn().mockReturnValue({ type: "user", id: "test-uuid" }),
}));

import prisma from "@calcom/prisma";
// Import after mocks are set up
import { GET } from "../route";

const TEST_KEY = "abcdefghjnmkljhjklmnhjklkmnbhjui"; // 32 bytes, like CALENDSO_ENCRYPTION_KEY

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A token exactly as OrganizerRequestEmail issues it. */
const makeToken = (payload: Record<string, unknown>) =>
  symmetricEncryptAuthenticated(JSON.stringify(payload), TEST_KEY, LINK_TOKEN_KEY_LABEL);

const validToken = (overrides: Record<string, unknown> = {}) =>
  makeToken({ bookingUid: "booking-a", userId: 1, iat: nowSeconds(), ...overrides });

const linkUrl = (origin: string, params: Record<string, string>) =>
  `${origin}/api/link?${new URLSearchParams(params).toString()}`;

const createMockRequest = (url: string): NextRequest => {
  const urlObj = new URL(url);
  return {
    method: "GET",
    url,
    nextUrl: {
      searchParams: urlObj.searchParams,
    },
  } as unknown as NextRequest;
};

const callLink = async (params: Record<string, string>, origin = "https://app.example.com") =>
  GET(createMockRequest(linkUrl(origin, params)), { params: Promise.resolve({}) });

// Vitest sets NEXT_PUBLIC_WEBAPP_URL to http://app.cal.local:3000 (see vitest.config.mts)
const EXPECTED_REDIRECT_ORIGIN = "http://app.cal.local:3000";
const INVALID_LINK_LOCATION = `${EXPECTED_REDIRECT_ORIGIN}/bookings/unconfirmed`;

const responseShape = (res: Response) => ({ status: res.status, location: res.headers.get("location") });

describe("link route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", TEST_KEY);
    vi.mocked(prisma.booking.findUnique).mockImplementation(
      (async (args: { where: { uid: string } }) => BOOKINGS[args.where.uid] ?? null) as never
    );
    vi.mocked(prisma.user.findUnique).mockImplementation(
      (async (args: { where: { id: number } }) => USERS[args.where.id] ?? null) as never
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe("GET handler - redirect URL construction", () => {
    it("should redirect to booking page using WEBAPP_URL (fixes localhost redirect when behind proxy)", async () => {
      const res = await callLink({ action: "accept", token: validToken() });
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(redirectUrl.pathname).toBe("/booking/booking-a");
    });

    it("should use WEBAPP_URL for redirects, not request.url (avoids localhost when proxy sends localhost)", async () => {
      const res = await callLink(
        { action: "accept", token: validToken() },
        "https://custom-domain.company.com"
      );
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(location).not.toContain("localhost");
    });

    it("should use WEBAPP_URL for self-hosted deployments", async () => {
      const res = await callLink(
        { action: "reject", token: validToken() },
        "https://calcom.internal.company.net"
      );
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(redirectUrl.pathname).toBe("/booking/booking-a");
    });

    it("should construct redirect URLs using WEBAPP_URL regardless of request origin", async () => {
      const testOrigins = [
        "https://app.cal.com",
        "https://acme.cal.com",
        "https://calcom.company.internal",
        "http://192.168.1.100:3000",
      ];

      for (const origin of testOrigins) {
        vi.clearAllMocks();
        const res = await callLink({ action: "accept", token: validToken() }, origin);
        const location = res.headers.get("location");

        expect(location).toBeTruthy();
        const redirectUrl = new URL(location!);

        expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
        expect(redirectUrl.pathname).toBe("/booking/booking-a");
      }
    });
  });

  describe("GET handler - error handling", () => {
    it("should redirect with error message when confirmHandler throws a TRPCError", async () => {
      const { TRPCError } = await import("@trpc/server");

      mockConfirmHandler.mockRejectedValueOnce(
        new TRPCError({ code: "BAD_REQUEST", message: "Custom error" })
      );

      const res = await callLink({ action: "accept", token: validToken() });
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(redirectUrl.pathname).toBe("/booking/booking-a");
      expect(redirectUrl.searchParams.get("error")).toBe("Custom error");
    });

    it("should use WEBAPP_URL for error redirects (not localhost when behind proxy)", async () => {
      const { TRPCError } = await import("@trpc/server");

      mockConfirmHandler.mockRejectedValueOnce(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }));

      const res = await callLink(
        { action: "accept", token: validToken() },
        "https://self-hosted.company.org"
      );
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);

      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(location).not.toContain("localhost");
    });
  });

  describe("confirmHandler flow", () => {
    it("should call confirmHandler with correct arguments for accept action", async () => {
      await callLink({ action: "accept", token: validToken() });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 11,
            confirmed: true,
            emailsEnabled: true,
          }),
        })
      );
    });

    it("should call confirmHandler with confirmed=false for reject action", async () => {
      await callLink({ action: "reject", token: validToken() });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 11,
            confirmed: false,
            emailsEnabled: true,
          }),
        })
      );
    });

    it("should call confirmHandler with reason when provided in query params", async () => {
      await callLink({ action: "reject", token: validToken(), reason: "test-reason" });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 11,
            confirmed: false,
            reason: "test-reason",
            emailsEnabled: true,
          }),
        })
      );
    });

    it("should pass recurringEventId when booking has one", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValueOnce({
        id: 11,
        uid: "booking-a",
        userId: 1,
        recurringEventId: "recurring-123",
      } as Awaited<ReturnType<typeof prisma.booking.findUnique>>);

      await callLink({ action: "accept", token: validToken() });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 11,
            recurringEventId: "recurring-123",
            confirmed: true,
          }),
        })
      );
    });

    it("should pass user context to confirmHandler", async () => {
      await callLink({ action: "accept", token: validToken() });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({
            user: expect.objectContaining({
              id: 1,
              uuid: "user-a-uuid",
              email: "a@example.com",
              username: "organizer-a",
              role: "USER",
            }),
          }),
        })
      );
    });

    it("should pass user context to confirmHandler input", async () => {
      await callLink({ action: "accept", token: validToken() });

      // After EE removal, actor/actionSource are no longer passed to confirmHandler
      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 11,
            confirmed: true,
          }),
        })
      );
    });
  });

  // Flowko: NAR-1. The token is authenticated, the acting organizer comes from the booking row, and every
  // invalid link gets one identical response, so there is no padding oracle and no forgery.
  describe("NAR-1 - authenticated token, organizer from the booking, uniform failure", () => {
    const expectInvalidLink = (res: Response) => {
      expect(responseShape(res)).toEqual({ status: 302, location: INVALID_LINK_LOCATION });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    };

    it("confirms as the organizer loaded from booking.userId", async () => {
      const res = await callLink({ action: "accept", token: validToken() });

      expect(res.headers.get("location")).toBe(`${EXPECTED_REDIRECT_ORIGIN}/booking/booking-a`);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(1);
      expect(mockConfirmHandler.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ bookingId: 11, confirmed: true })
      );
    });

    it("rejects as the organizer loaded from booking.userId", async () => {
      const res = await callLink({
        action: "reject",
        token: makeToken({ bookingUid: "booking-b", userId: 2, iat: nowSeconds() }),
      });

      expect(res.headers.get("location")).toBe(`${EXPECTED_REDIRECT_ORIGIN}/booking/booking-b`);
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(2);
      expect(mockConfirmHandler.mock.calls[0][0].input).toEqual(
        expect.objectContaining({ bookingId: 22, confirmed: false })
      );
    });

    it("refuses a valid token that names booking A with user B's id", async () => {
      const res = await callLink({
        action: "accept",
        token: makeToken({ bookingUid: "booking-a", userId: 2, iat: nowSeconds() }),
      });

      expectInvalidLink(res);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("refuses a booking without an organizer", async () => {
      expectInvalidLink(
        await callLink({
          action: "accept",
          token: makeToken({ bookingUid: "booking-orphan", userId: 0, iat: nowSeconds() }),
        })
      );
    });

    it("refuses a token for an unknown booking, and one whose organizer no longer exists", async () => {
      expectInvalidLink(
        await callLink({
          action: "accept",
          token: makeToken({ bookingUid: "no-such-booking", userId: 1, iat: nowSeconds() }),
        })
      );

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      expectInvalidLink(await callLink({ action: "accept", token: validToken() }));
    });

    it("refuses the token when any single character is changed", async () => {
      const token = validToken();
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      for (let i = 0; i < token.length; i++) {
        vi.clearAllMocks();
        const next = alphabet[(alphabet.indexOf(token[i]) + 1) % alphabet.length];
        const tampered = token.slice(0, i) + next + token.slice(i + 1);
        expectInvalidLink(await callLink({ action: "accept", token: tampered }));
      }
    });

    it("refuses the token when any single byte is flipped", async () => {
      const raw = Buffer.from(validToken(), "base64url");
      for (let i = 0; i < raw.length; i++) {
        vi.clearAllMocks();
        const tampered = Buffer.from(raw);
        tampered[i] ^= 0x01;
        expectInvalidLink(await callLink({ action: "accept", token: tampered.toString("base64url") }));
      }
    });

    it("refuses an old unauthenticated AES-256-CBC token, even one naming the real organizer", async () => {
      const legacy = symmetricEncrypt(JSON.stringify({ bookingUid: "booking-a", userId: 1 }), TEST_KEY);
      expectInvalidLink(await callLink({ action: "accept", token: legacy }));
      expectInvalidLink(await callLink({ action: "accept", token: encodeURIComponent(legacy) }));
    });

    it("refuses a token encrypted under another purpose's derived key", async () => {
      const payload = JSON.stringify({ bookingUid: "booking-a", userId: 1, iat: nowSeconds() });
      const underOtherLabel = symmetricEncryptAuthenticated(payload, TEST_KEY, "flowko:other-purpose");
      expectInvalidLink(await callLink({ action: "accept", token: underOtherLabel }));
    });

    it("refuses an expired token and one issued in the future", async () => {
      const thirtyOneDays = 31 * 24 * 60 * 60;
      expectInvalidLink(
        await callLink({ action: "accept", token: validToken({ iat: nowSeconds() - thirtyOneDays }) })
      );
      expectInvalidLink(
        await callLink({ action: "accept", token: validToken({ iat: nowSeconds() + 60 * 60 }) })
      );
    });

    it("accepts a token right up to the 30-day expiry", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
      const token = validToken();
      vi.setSystemTime(new Date("2026-10-24T11:59:00Z"));

      const res = await callLink({ action: "accept", token });
      expect(res.headers.get("location")).toBe(`${EXPECTED_REDIRECT_ORIGIN}/booking/booking-a`);
      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      vi.setSystemTime(new Date("2026-10-24T12:01:00Z"));
      expectInvalidLink(await callLink({ action: "accept", token }));
    });

    it("refuses a token without an issued-at", async () => {
      expectInvalidLink(
        await callLink({ action: "accept", token: makeToken({ bookingUid: "booking-a", userId: 1 }) })
      );
    });

    it("answers bad padding, bad JSON, bad schema, bad query and not-found identically, without throwing", async () => {
      // AES-256-CBC with invalid PKCS#7 padding: the old padding-oracle "bad decrypt" case.
      const badPadding = `${"00".repeat(16)}:${"11".repeat(32)}`;
      // AES-256-CBC with valid padding but a non-JSON plaintext: the old "Unexpected error" case.
      const badJsonCbc = symmetricEncrypt("not json", TEST_KEY);
      // Authenticated, but not JSON / not the schema.
      const badJson = symmetricEncryptAuthenticated("not json", TEST_KEY, LINK_TOKEN_KEY_LABEL);
      const badSchema = makeToken({ bookingUid: 123, userId: "1", iat: nowSeconds() });

      const cases: Record<string, string>[] = [
        { action: "accept", token: badPadding },
        { action: "accept", token: badJsonCbc },
        { action: "accept", token: badJson },
        { action: "accept", token: badSchema },
        { action: "accept", token: "%E0%A4%A" }, // malformed percent-encoding
        { action: "accept", token: "" },
        { action: "accept" }, // no token
        { action: "approve", token: validToken() }, // unknown action
        { action: "accept", token: makeToken({ bookingUid: "no-such", userId: 1, iat: nowSeconds() }) },
      ];

      const shapes = [];
      for (const params of cases) {
        const res = await callLink(params);
        shapes.push(responseShape(res));
      }

      expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
      expect(shapes[0]).toEqual({ status: 302, location: INVALID_LINK_LOCATION });
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("gives the same answer when a database lookup throws", async () => {
      vi.mocked(prisma.booking.findUnique).mockRejectedValueOnce(new Error("connection refused"));
      expectInvalidLink(await callLink({ action: "accept", token: validToken() }));
    });

    it("refuses the legacy /booking/direct redirect target, which carries no token", async () => {
      // next.config.ts redirects /booking/direct/:action/:email/:bookingUid/:oldToken to this query shape.
      const res = await callLink({
        action: "accept",
        email: "a@example.com",
        bookingUid: "booking-a",
        oldToken: validToken(),
      });
      expectInvalidLink(res);
    });

    it("ignores bookingUid and userId query params next to a valid token", async () => {
      await callLink({ action: "accept", token: validToken(), bookingUid: "booking-b", userId: "2" });

      expect(mockConfirmHandler).toHaveBeenCalledTimes(1);
      expect(mockConfirmHandler.mock.calls[0][0].ctx.user.id).toBe(1);
      expect(mockConfirmHandler.mock.calls[0][0].input.bookingId).toBe(11);
    });

    it("fails closed when CALENDSO_ENCRYPTION_KEY is missing", async () => {
      const token = validToken();
      vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "");
      expectInvalidLink(await callLink({ action: "accept", token }));
    });
  });
});
