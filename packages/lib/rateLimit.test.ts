import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unkey = vi.hoisted(() => ({
  configs: [] as Array<{ namespace: string; limit: number; duration: string; rootKey: string } & Record<string, unknown>>,
  limit: vi.fn(),
}));

vi.mock("@unkey/ratelimit", () => ({
  Ratelimit: class {
    config: { namespace: string };
    constructor(config: (typeof unkey.configs)[number]) {
      this.config = config;
      unkey.configs.push(config);
    }
    limit(identifier: string, opts?: unknown) {
      return unkey.limit(this.config.namespace, identifier, opts);
    }
  },
}));

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  team: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@calcom/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import { checkRateLimitAndThrowError } from "./checkRateLimitAndThrowError";
import { HttpError } from "./http-error";
import {
  createInMemoryRateLimiter,
  IN_MEMORY_RATE_LIMIT_MAX_ENTRIES,
  IN_MEMORY_RATE_LIMITS,
  rateLimiter,
} from "./rateLimit";
import { checkSMSRateLimit } from "./smsLockState";

const T0 = 1_800_000_000_000;

function fakeClock() {
  let t = T0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function resetSharedLimiter() {
  delete (globalThis as { flowkoInMemoryRateLimiter?: unknown }).flowkoInMemoryRateLimiter;
}

// rateLimiter() treats vitest as a test run; these pretend to be the production server.
function runAsProductionWithoutUnkey() {
  vi.stubEnv("UNKEY_ROOT_KEY", "");
  vi.stubEnv("VITEST", "");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_IS_E2E", "");
}

beforeEach(() => {
  unkey.configs.length = 0;
  unkey.limit.mockReset();
  vi.clearAllMocks();
  resetSharedLimiter();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSharedLimiter();
});

describe("createInMemoryRateLimiter", () => {
  it("lets `limit` calls through in a window, denies the next one and answers in Unkey's shape", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now });

    for (let i = 1; i <= 10; i++) {
      await expect(limiter({ rateLimitingType: "core", identifier: "createBooking:ip-a" })).resolves.toEqual({
        success: true,
        limit: 10,
        remaining: 10 - i,
        reset: T0 + 60_000,
      });
    }

    await expect(limiter({ rateLimitingType: "core", identifier: "createBooking:ip-a" })).resolves.toEqual({
      success: false,
      limit: 10,
      remaining: 0,
      reset: T0 + 60_000,
    });
  });

  it("defaults to the core limits when no rateLimitingType is given", async () => {
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });
    for (let i = 0; i < 10; i++) {
      expect((await limiter({ identifier: "login-email-hash" })).success).toBe(true);
    }
    expect((await limiter({ identifier: "login-email-hash" })).success).toBe(false);
  });

  it("uses the per-type limit and duration", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now });

    for (let i = 0; i < 200; i++) {
      expect((await limiter({ rateLimitingType: "common", identifier: "eventTypes:list:7" })).success).toBe(true);
    }
    const denied = await limiter({ rateLimitingType: "common", identifier: "eventTypes:list:7" });
    expect(denied).toMatchObject({ success: false, limit: 200, reset: T0 + 60_000 });

    const first = await limiter({ rateLimitingType: "instantMeeting", identifier: "user-7" });
    expect(first).toEqual({ success: true, limit: 1, remaining: 0, reset: T0 + 10 * 60_000 });
    expect((await limiter({ rateLimitingType: "instantMeeting", identifier: "user-7" })).success).toBe(false);
  });

  it("puts a banned identifier in forced slow mode, whatever the type", async () => {
    vi.stubEnv("IP_BANLIST", JSON.stringify(["203.0.113.9"]));
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });

    await expect(limiter({ rateLimitingType: "common", identifier: "203.0.113.9" })).resolves.toEqual({
      success: true,
      limit: 1,
      remaining: 0,
      reset: T0 + 30_000,
    });
    expect((await limiter({ rateLimitingType: "common", identifier: "203.0.113.9" })).success).toBe(false);
  });

  it("ignores a malformed IP_BANLIST instead of failing every limited call", async () => {
    vi.stubEnv("IP_BANLIST", "203.0.113.9");
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });

    for (let i = 0; i < 10; i++) {
      expect((await limiter({ identifier: "203.0.113.9" })).success).toBe(true);
    }
    expect((await limiter({ identifier: "203.0.113.9" })).success).toBe(false);
  });

  it("counts every identifier and every type separately", async () => {
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });
    for (let i = 0; i < 10; i++) await limiter({ rateLimitingType: "core", identifier: "a" });

    expect((await limiter({ rateLimitingType: "core", identifier: "a" })).success).toBe(false);
    expect(await limiter({ rateLimitingType: "core", identifier: "b" })).toMatchObject({
      success: true,
      remaining: 9,
    });
    expect(await limiter({ rateLimitingType: "common", identifier: "a" })).toMatchObject({
      success: true,
      remaining: 199,
    });
  });

  it("opens a new window once the old one has reset", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now });
    for (let i = 0; i < 10; i++) await limiter({ rateLimitingType: "core", identifier: "a" });

    clock.advance(59_999);
    expect((await limiter({ rateLimitingType: "core", identifier: "a" })).success).toBe(false);

    clock.advance(1);
    await expect(limiter({ rateLimitingType: "core", identifier: "a" })).resolves.toEqual({
      success: true,
      limit: 10,
      remaining: 9,
      reset: T0 + 120_000,
    });
  });

  it("does not let denied calls extend the window or carry into the next one", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now });
    let last: Awaited<ReturnType<typeof limiter>> | undefined;
    for (let i = 0; i < 50; i++) {
      clock.advance(1000);
      last = await limiter({ rateLimitingType: "core", identifier: "a" });
    }
    expect(last).toEqual({ success: false, limit: 10, remaining: 0, reset: T0 + 1000 + 60_000 });

    clock.advance(60_000);
    for (let i = 0; i < 10; i++) {
      expect((await limiter({ rateLimitingType: "core", identifier: "a" })).success).toBe(true);
    }
  });

  it("honours opts.cost and an opts.limit override like Unkey does", async () => {
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });

    expect(await limiter({ identifier: "c", opts: { cost: 4 } })).toMatchObject({ success: true, remaining: 6 });
    expect(await limiter({ identifier: "c", opts: { cost: 4 } })).toMatchObject({ success: true, remaining: 2 });
    expect(await limiter({ identifier: "c", opts: { cost: 4 } })).toMatchObject({ success: false, remaining: 2 });

    const opts = { limit: { limit: 2, duration: "1s" as const } };
    expect(await limiter({ identifier: "o", opts })).toEqual({ success: true, limit: 2, remaining: 1, reset: T0 + 1000 });
    expect((await limiter({ identifier: "o", opts })).success).toBe(true);
    expect((await limiter({ identifier: "o", opts })).success).toBe(false);
  });

  it("never evicts a live window: a denying identifier stays denied however many new ones arrive", async () => {
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now, maxEntries: 3 });
    for (let i = 0; i < 10; i++) await limiter({ identifier: "target" });
    expect((await limiter({ identifier: "target" })).success).toBe(false);
    await limiter({ identifier: "b" });
    await limiter({ identifier: "c" });
    expect(limiter.size()).toBe(3);

    for (let i = 0; i < 3 + 20; i++) await limiter({ identifier: `flood-${i}` });

    expect(limiter.size()).toBe(3);
    expect((await limiter({ identifier: "target" })).success).toBe(false);
    // The windows that were there keep their own counts.
    expect(await limiter({ identifier: "b" })).toMatchObject({ success: true, remaining: 8 });
  });

  it("counts identifiers that are new while the store is full in one overflow window per namespace", async () => {
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now, maxEntries: 2 });
    await limiter({ identifier: "a" });
    await limiter({ identifier: "b" });

    for (let i = 1; i <= 10; i++) {
      await expect(limiter({ identifier: `new-${i % 3}` })).resolves.toEqual({
        success: true,
        limit: 10,
        remaining: 10 - i,
        reset: T0 + 60_000,
      });
    }
    // Fail closed: an eleventh new identifier is denied, even one never seen before.
    await expect(limiter({ identifier: "never-seen" })).resolves.toEqual({
      success: false,
      limit: 10,
      remaining: 0,
      reset: T0 + 60_000,
    });
    expect(limiter.size()).toBe(2);

    // Other namespaces and overrides overflow separately, with their own limits.
    expect(await limiter({ rateLimitingType: "common", identifier: "eventTypes:list:7" })).toMatchObject({
      success: true,
      limit: 200,
      remaining: 199,
    });
    const opts = { limit: { limit: 3, duration: "60s" as const } };
    expect(await limiter({ identifier: "override", opts })).toMatchObject({ success: true, limit: 3, remaining: 2 });
    // Identifiers that already had a window are unaffected.
    expect(await limiter({ identifier: "a" })).toMatchObject({ success: true, remaining: 8 });
  });

  it("gives new identifiers their own window again as soon as expired ones are pruned", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now, maxEntries: 2 });
    await limiter({ identifier: "a" });
    clock.advance(30_000);
    await limiter({ identifier: "b" });
    for (let i = 0; i < 10; i++) await limiter({ identifier: `flood-${i}` });
    expect((await limiter({ identifier: "late" })).success).toBe(false);

    // "a" expires first and frees exactly one slot, with no once-a-minute delay.
    clock.advance(30_000);
    expect(await limiter({ identifier: "late" })).toMatchObject({
      success: true,
      remaining: 9,
      reset: T0 + 120_000,
    });
    expect(limiter.size()).toBe(2);
    expect((await limiter({ identifier: "later" })).success).toBe(false);
  });

  it("resets the overflow window after its duration while the store stays full", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now, maxEntries: 1 });
    await limiter({ rateLimitingType: "ai", identifier: "long-lived" });
    for (let i = 0; i < 10; i++) await limiter({ identifier: `flood-${i}` });
    expect((await limiter({ identifier: "flood-x" })).success).toBe(false);

    clock.advance(60_000);
    expect(await limiter({ identifier: "flood-y" })).toMatchObject({
      success: true,
      remaining: 9,
      reset: T0 + 120_000,
    });
    expect(limiter.size()).toBe(1);
  });

  it("never holds more than 50k windows by default, and a flood past the cap resets no counter", async () => {
    expect(IN_MEMORY_RATE_LIMIT_MAX_ENTRIES).toBe(50_000);
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });
    for (let i = 0; i < 10; i++) await limiter({ identifier: "admin-login" });
    expect((await limiter({ identifier: "admin-login" })).success).toBe(false);

    for (let i = 0; i < IN_MEMORY_RATE_LIMIT_MAX_ENTRIES + 500; i++) {
      await limiter({ identifier: `emailVerifyCode.${i}` });
    }
    expect(limiter.size()).toBe(IN_MEMORY_RATE_LIMIT_MAX_ENTRIES);
    expect((await limiter({ identifier: "admin-login" })).success).toBe(false);
  });

  it("prunes expired windows", async () => {
    const clock = fakeClock();
    const limiter = createInMemoryRateLimiter({ now: clock.now });
    for (let i = 0; i < 5; i++) await limiter({ identifier: `ip-${i}` });
    await limiter({ rateLimitingType: "ai", identifier: "long-lived" });
    expect(limiter.size()).toBe(6);

    clock.advance(60_000);
    await limiter({ identifier: "new" });
    // The five 60s windows are gone; the one-day window and the new one remain.
    expect(limiter.size()).toBe(2);
  });

  it("lets both SMS namespaces through, as before", async () => {
    const limiter = createInMemoryRateLimiter({ now: fakeClock().now });
    for (let i = 0; i < 300; i++) {
      expect((await limiter({ rateLimitingType: "sms", identifier: "handleSendingSMS:org-user-1" })).success).toBe(
        true
      );
      expect(
        (await limiter({ rateLimitingType: "smsMonth", identifier: "handleSendingSMS:org-user-1" })).success
      ).toBe(true);
    }
    expect(limiter.size()).toBe(0);
  });
});

describe("rateLimiter", () => {
  it("keeps the always-success limiter under vitest when UNKEY_ROOT_KEY is unset", async () => {
    vi.stubEnv("UNKEY_ROOT_KEY", "");
    for (let i = 0; i < 20; i++) {
      await expect(checkRateLimitAndThrowError({ identifier: "under-test" })).resolves.toEqual({
        success: true,
        limit: 10,
        remaining: 999,
        reset: 0,
      });
    }
  });

  it("keeps the always-success limiter for the Playwright server (NEXT_PUBLIC_IS_E2E)", async () => {
    runAsProductionWithoutUnkey();
    vi.stubEnv("NEXT_PUBLIC_IS_E2E", "1");
    for (let i = 0; i < 20; i++) {
      await expect(checkRateLimitAndThrowError({ identifier: "createBooking:127.0.0.1" })).resolves.toMatchObject({
        success: true,
      });
    }
  });

  it("enforces the core limit through checkRateLimitAndThrowError when UNKEY_ROOT_KEY is unset", async () => {
    runAsProductionWithoutUnkey();
    const onRateLimiterResponse = vi.fn();

    for (let i = 0; i < 10; i++) {
      await checkRateLimitAndThrowError({ identifier: "api:cancel-ip:hash", onRateLimiterResponse });
    }
    expect(onRateLimiterResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ success: true, limit: 10, remaining: 0, reset: expect.any(Number) })
    );

    const error = await checkRateLimitAndThrowError({
      identifier: "api:cancel-ip:hash",
      onRateLimiterResponse,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(429);
    expect(error.message).toMatch(/^Rate limit exceeded\. Try again in (59|60) seconds\.$/);
    expect(onRateLimiterResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({ success: false, limit: 10, remaining: 0 })
    );

    // Another client is not affected, and Unkey is never touched.
    await expect(checkRateLimitAndThrowError({ identifier: "api:cancel-ip:other" })).resolves.toMatchObject({
      success: true,
    });
    expect(unkey.configs).toHaveLength(0);
  });

  it("shares one store across rateLimiter() calls, because callers build a new one per request", async () => {
    runAsProductionWithoutUnkey();
    expect(rateLimiter()).toBe(rateLimiter());
    for (let i = 0; i < 10; i++) await rateLimiter()({ identifier: "shared" });
    expect((await rateLimiter()({ identifier: "shared" })).success).toBe(false);
  });

  it("never locks SMS through checkSMSRateLimit", async () => {
    runAsProductionWithoutUnkey();
    for (let i = 0; i < 300; i++) {
      await checkSMSRateLimit({ identifier: "handleSendingSMS:org-user-1", rateLimitingType: "sms" });
      await checkSMSRateLimit({ identifier: "sms:user:1", rateLimitingType: "smsMonth" });
    }
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.team.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.team.update).not.toHaveBeenCalled();
  });

  it("keeps using Unkey, with the same limits, when UNKEY_ROOT_KEY is set", async () => {
    vi.stubEnv("UNKEY_ROOT_KEY", "unkey_test_root_key");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    const unkeyResponse = { success: false, limit: 200, remaining: 0, reset: T0 };
    unkey.limit.mockResolvedValue(unkeyResponse);

    const limit = rateLimiter();
    await expect(limit({ rateLimitingType: "common", identifier: "eventTypes:list:7" })).resolves.toBe(
      unkeyResponse
    );
    expect(unkey.limit).toHaveBeenCalledWith("common", "eventTypes:list:7", undefined);

    const byNamespace = Object.fromEntries(unkey.configs.map((config) => [config.namespace, config]));
    expect(Object.keys(byNamespace).sort()).toEqual(Object.keys(IN_MEMORY_RATE_LIMITS).sort());
    for (const [namespace, { limit: max, duration }] of Object.entries(IN_MEMORY_RATE_LIMITS)) {
      expect(byNamespace[namespace]).toMatchObject({ rootKey: "unkey_test_root_key", limit: max, duration });
    }
    // Unkey still fails open on its own errors and timeouts, as upstream.
    expect(byNamespace.core.timeout).toEqual({
      fallback: { success: true, limit: 10, remaining: 999, reset: 0 },
      ms: 5000,
    });
    const onError = byNamespace.core.onError as (err: Error, identifier: string) => unknown;
    expect(onError(new Error("down"), "x")).toEqual({ success: true, limit: 10, remaining: 999, reset: 0 });

    vi.stubEnv("IP_BANLIST", JSON.stringify(["203.0.113.9"]));
    await limit({ rateLimitingType: "core", identifier: "203.0.113.9" });
    expect(unkey.limit).toHaveBeenLastCalledWith("forcedSlowMode", "203.0.113.9", undefined);
  });
});
