import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { piiHasher } from "@calcom/lib/server/PiiHasher";

import { userWithEmailHandler } from "./checkIfUserEmailVerificationRequired.handler";

const { findManyByEmailsWithEmailVerificationSettings } = vi.hoisted(() => ({
  findManyByEmailsWithEmailVerificationSettings: vi.fn(),
}));

vi.mock("@calcom/features/users/repositories/UserRepository", () => ({
  UserRepository: class {
    findManyByEmailsWithEmailVerificationSettings = findManyByEmailsWithEmailVerificationSettings;
  },
}));

vi.mock("@calcom/prisma", () => ({ prisma: {}, default: {} }));

// The real limiter, wrapped so the tests can see what it is called with
vi.mock("@calcom/lib/checkRateLimitAndThrowError", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/checkRateLimitAndThrowError")>();
  return { checkRateLimitAndThrowError: vi.fn(actual.checkRateLimitAndThrowError) };
});

const TENANT_EMAIL = "info@salon.si";

function ctxFrom(ip: string) {
  return { req: { headers: { "x-forwarded-for": ip } } } as unknown as Parameters<
    typeof userWithEmailHandler
  >[0]["ctx"];
}

function resetSharedLimiter() {
  delete (globalThis as { flowkoInMemoryRateLimiter?: unknown }).flowkoInMemoryRateLimiter;
}

describe("publicViewer.checkIfUserEmailVerificationRequired handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedLimiter();
    findManyByEmailsWithEmailVerificationSettings.mockImplementation(async ({ emails }: { emails: string[] }) =>
      emails[0] === TENANT_EMAIL ? [{ email: TENANT_EMAIL, requiresBookerEmailVerification: true }] : []
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSharedLimiter();
  });

  it("asks for verification when a booker uses the email of a user who requires it", async () => {
    await expect(
      userWithEmailHandler({ ctx: ctxFrom("203.0.113.1"), input: { email: TENANT_EMAIL } })
    ).resolves.toBe(true);
  });

  it("does not ask the signed-in user whose own email it is", async () => {
    await expect(
      userWithEmailHandler({
        ctx: ctxFrom("203.0.113.1"),
        input: { email: TENANT_EMAIL },
        userSessionEmail: "INFO@salon.si",
      })
    ).resolves.toBe(false);
  });

  // The input schema no longer carries it, and the handler must not read it from the input either
  it("ignores a userSessionEmail smuggled into the input", async () => {
    await expect(
      userWithEmailHandler({
        ctx: ctxFrom("203.0.113.1"),
        input: { email: TENANT_EMAIL, userSessionEmail: TENANT_EMAIL } as never,
      })
    ).resolves.toBe(true);
  });

  it("counts every call against the caller's hashed IP", async () => {
    await userWithEmailHandler({ ctx: ctxFrom("203.0.113.7"), input: { email: "someone@example.com" } });

    expect(checkRateLimitAndThrowError).toHaveBeenCalledWith({
      rateLimitingType: "core",
      identifier: `checkIfUserEmailVerificationRequired:${piiHasher.hash("203.0.113.7")}`,
    });
  });

  // UNKEY_ROOT_KEY is unset on booking.flowko.si, so this is the in-process limiter it runs with
  it("stops a caller after 10 checks a minute, before it looks the address up", async () => {
    vi.stubEnv("UNKEY_ROOT_KEY", "");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_IS_E2E", "");

    const check = (ip: string, i: number) =>
      userWithEmailHandler({ ctx: ctxFrom(ip), input: { email: `guess-${i}@example.com` } });

    for (let i = 0; i < 10; i++) {
      await expect(check("203.0.113.9", i)).resolves.toBe(false);
    }
    await expect(check("203.0.113.9", 10)).rejects.toMatchObject({ statusCode: 429 });
    expect(findManyByEmailsWithEmailVerificationSettings).toHaveBeenCalledTimes(10);

    // Another IP has its own window
    await expect(check("198.51.100.4", 11)).resolves.toBe(false);
  });
});
