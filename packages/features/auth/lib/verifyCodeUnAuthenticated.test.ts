import { HttpError } from "@calcom/lib/http-error";
import { createInMemoryRateLimiter } from "@calcom/lib/rateLimit";
import { totpRawCheck } from "@calcom/lib/totp";
import type { NextApiRequest } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyCodeUnAuthenticated } from "./verifyCodeUnAuthenticated";

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

vi.mock("@calcom/lib/totp", () => ({
  totpRawCheck: vi.fn(),
}));

const mockTotpRawCheck = vi.mocked(totpRawCheck);

const requestFrom = (ip: string, extraHeaders: Record<string, string> = {}) =>
  ({ headers: { "x-forwarded-for": ip, ...extraHeaders } }) as unknown as NextApiRequest;

/** Resolves to "ok", "invalid" (the code check ran and failed) or "limited" (a 429 before the code check). */
const attempt = async (email: string, req?: Request | NextApiRequest) => {
  try {
    await verifyCodeUnAuthenticated(email, "123456", req);
    return "ok";
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 429) return "limited";
    if (error instanceof Error && error.message === "Invalid verification code") return "invalid";
    throw error;
  }
};

describe("verifyCodeUnAuthenticated rate limits", () => {
  beforeEach(() => {
    rateLimitState.now = 1_800_000_000_000;
    rateLimitState.limiter = createInMemoryRateLimiter({ now: () => rateLimitState.now });
    mockTotpRawCheck.mockReset();
    mockTotpRawCheck.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caps one IP at 10 attempts a minute across different emails", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await attempt(`guest${i}@example.com`, requestFrom("198.51.100.1"))).toBe("invalid");
    }

    expect(await attempt("guest10@example.com", requestFrom("198.51.100.1"))).toBe("limited");
    // The code is not checked once the IP is refused.
    expect(mockTotpRawCheck).toHaveBeenCalledTimes(10);
  });

  it("keys the IP limit by the client IP, so another IP keeps its own attempts", async () => {
    for (let i = 0; i < 10; i++) {
      await attempt(`guest${i}@example.com`, requestFrom("198.51.100.1"));
    }

    expect(await attempt("other@example.com", requestFrom("198.51.100.2"))).toBe("invalid");
  });

  it("reads the IP from a fetch Request too", async () => {
    const fetchRequest = () =>
      new Request("https://booking.example.com/api/trpc", { headers: { "x-forwarded-for": "198.51.100.3" } });
    for (let i = 0; i < 10; i++) {
      expect(await attempt(`guest${i}@example.com`, fetchRequest())).toBe("invalid");
    }

    expect(await attempt("guest10@example.com", fetchRequest())).toBe("limited");
  });

  it("ignores a client-sent cf-connecting-ip, so it cannot mint a fresh IP per attempt", async () => {
    vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", "");
    for (let i = 0; i < 10; i++) {
      const req = requestFrom("198.51.100.1", { "cf-connecting-ip": `203.0.113.${i}` });
      expect(await attempt(`guest${i}@example.com`, req)).toBe("invalid");
    }

    const req = requestFrom("198.51.100.1", { "cf-connecting-ip": "203.0.113.99" });
    expect(await attempt("guest10@example.com", req)).toBe("limited");
  });

  it("does not use up the email's own attempts when the IP is refused", async () => {
    for (let i = 0; i < 10; i++) {
      await attempt(`guest${i}@example.com`, requestFrom("198.51.100.1"));
    }
    expect(await attempt("victim@example.com", requestFrom("198.51.100.1"))).toBe("limited");

    // The refused attempt above never reached the email's limit, so its owner still has all 10.
    for (let i = 0; i < 10; i++) {
      expect(await attempt("victim@example.com", requestFrom(`198.51.100.${10 + i}`))).toBe("invalid");
    }
  });

  it("still limits one email to 10 attempts a minute across IPs", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await attempt("victim@example.com", requestFrom(`198.51.100.${10 + i}`))).toBe("invalid");
    }

    expect(await attempt("victim@example.com", requestFrom("198.51.100.99"))).toBe("limited");
  });

  it("frees the IP again once the window has passed", async () => {
    for (let i = 0; i < 10; i++) {
      await attempt(`guest${i}@example.com`, requestFrom("198.51.100.1"));
    }
    expect(await attempt("guest10@example.com", requestFrom("198.51.100.1"))).toBe("limited");

    rateLimitState.now += 60_000;

    expect(await attempt("guest10@example.com", requestFrom("198.51.100.1"))).toBe("invalid");
  });

  it("accepts a valid code from an IP within its limit", async () => {
    mockTotpRawCheck.mockReturnValue(true);

    await expect(
      verifyCodeUnAuthenticated("guest@example.com", "123456", requestFrom("198.51.100.1"))
    ).resolves.toBe(true);
  });

  it("keeps only the email limit for callers without a request (the booking routes limit by IP first)", async () => {
    for (let i = 0; i < 11; i++) {
      expect(await attempt(`guest${i}@example.com`)).toBe("invalid");
    }
  });

  it("still requires an email and a code", async () => {
    await expect(verifyCodeUnAuthenticated("", "123456", requestFrom("198.51.100.1"))).rejects.toThrow(
      "Email and code are required"
    );
    await expect(verifyCodeUnAuthenticated("guest@example.com", "", requestFrom("198.51.100.1"))).rejects.toThrow(
      "Email and code are required"
    );
  });
});
