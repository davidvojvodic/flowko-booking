import { Ratelimit, type LimitOptions, type RatelimitResponse } from "@unkey/ratelimit";

import { isIpInBanListString } from "./getIP";
import logger from "./logger";

const log = logger.getSubLogger({ prefix: ["RateLimit"] });

export { type RatelimitResponse };

export type RateLimitHelper = {
  rateLimitingType?:
    | "core"
    | "forcedSlowMode"
    | "common"
    | "api"
    | "ai"
    | "sms"
    | "smsMonth"
    | "instantMeeting";
  identifier: string;
  opts?: LimitOptions;
  /**
   * Using a callback instead of a regular return to provide headers even
   * when the rate limit is reached and an error is thrown.
   **/
  onRateLimiterResponse?: (response: RatelimitResponse) => void;
};

export const API_KEY_RATE_LIMIT = 30;

type RateLimitingType = NonNullable<RateLimitHelper["rateLimitingType"]>;
type Duration = `${number}${"ms" | "s" | "m" | "h" | "d"}`;

/**
 * Flowko: the limits of the in-process fallback below. They mirror the Unkey namespaces in rateLimiter()
 * one for one (rateLimit.test.ts pins that). sms and smsMonth are listed for that parity check only: the
 * in-memory limiter always lets both through (see rateLimit() in createInMemoryRateLimiter).
 */
export const IN_MEMORY_RATE_LIMITS: Record<RateLimitingType, { limit: number; duration: Duration }> = {
  core: { limit: 10, duration: "60s" },
  instantMeeting: { limit: 1, duration: "10m" },
  common: { limit: 200, duration: "60s" },
  forcedSlowMode: { limit: 1, duration: "30s" },
  api: { limit: API_KEY_RATE_LIMIT, duration: "60s" },
  ai: { limit: 20, duration: "1d" },
  sms: { limit: 50, duration: "5m" },
  smsMonth: { limit: 250, duration: "30d" },
};

/**
 * Flowko: at most this many live windows are kept. A live window is never dropped to make room, because
 * then anyone could reset every counter (a denying one included) by flooding the store with fresh
 * identifiers. A new identifier that finds the store full is counted in its namespace's overflow window.
 */
export const IN_MEMORY_RATE_LIMIT_MAX_ENTRIES = 50_000;

const DURATION_UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// Same parser as @unkey/ratelimit's, so an opts.limit override means the same on both paths.
function durationToMs(duration: string | number): number {
  if (typeof duration === "number") return duration;
  const match = duration.match(/^(\d+)\s?(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Unable to parse window size: ${duration}`);
  return Number.parseInt(match[1], 10) * DURATION_UNIT_MS[match[2] as keyof typeof DURATION_UNIT_MS];
}

export type InMemoryRateLimiter = (helper: RateLimitHelper) => Promise<RatelimitResponse>;

type Window = { count: number; resetAt: number };

/**
 * Flowko: an in-process fixed-window limiter with the same limits, keys and response shape as the Unkey path.
 * Without it every checkRateLimitAndThrowError call site (booking, cancel, forgot/reset password, 2FA, email
 * codes, login) passes unconditionally when UNKEY_ROOT_KEY is unset. booking.flowko.si runs one web replica,
 * so per-process counters are exact there; they reset on every deploy. Memory stays bounded: expired windows
 * are pruned on every call, and past `maxEntries` new identifiers share one overflow window per namespace
 * (fail closed) instead of evicting anyone's live window.
 * Exported so tests can drive it with their own clock; production code gets it through rateLimiter().
 */
export function createInMemoryRateLimiter({
  maxEntries = IN_MEMORY_RATE_LIMIT_MAX_ENTRIES,
  now = Date.now,
}: { maxEntries?: number; now?: () => number } = {}): InMemoryRateLimiter & { size: () => number } {
  // One Map per window length. Within one, insertion order is resetAt order (an expired window is deleted
  // before its key is set again), so expired windows sit at the front and pruning stops at the first live
  // one: it costs only what it removes, which is why it can run on every call.
  const windowsByDuration = new Map<number, Map<string, Window>>();
  // At most one per namespace + limit + duration, all of which are fixed in code, so this stays tiny.
  const overflowWindows = new Map<string, Window>();
  let size = 0;

  function pruneExpired(t: number) {
    windowsByDuration.forEach((windows) => {
      const entries = windows.entries();
      let entry = entries.next();
      while (!entry.done && entry.value[1].resetAt <= t) {
        windows.delete(entry.value[0]);
        size--;
        entry = entries.next();
      }
    });
  }

  function take(window: Window, limit: number, cost: number): RatelimitResponse {
    if (window.count + cost > limit) {
      return { success: false, limit, remaining: Math.max(0, limit - window.count), reset: window.resetAt };
    }
    window.count += cost;
    return { success: true, limit, remaining: limit - window.count, reset: window.resetAt };
  }

  function limitWindow(namespace: RateLimitingType, identifier: string, opts?: LimitOptions): RatelimitResponse {
    const config = IN_MEMORY_RATE_LIMITS[namespace];
    const limit = opts?.limit?.limit ?? config.limit;
    const durationMs = durationToMs(opts?.limit?.duration ?? config.duration);
    const cost = opts?.cost ?? 1;
    const t = now();
    pruneExpired(t);

    let windows = windowsByDuration.get(durationMs);
    if (!windows) {
      windows = new Map();
      windowsByDuration.set(durationMs, windows);
    }
    const key = `${namespace}:${identifier}:${limit}:${durationMs}`;
    let window = windows.get(key);
    if (window && window.resetAt <= t) {
      // Only reachable if the clock stepped back and pruning stopped early.
      windows.delete(key);
      size--;
      window = undefined;
    }
    if (!window) {
      if (size >= maxEntries) {
        // Flowko: the store is full of live windows. Evicting one would reset its counter, so a flood of
        // fresh identifiers could reset a denying login or code window. Fail closed instead: every
        // identifier that is new while the store is full shares this namespace's overflow window, with the
        // namespace's own limit, until pruning frees room (at most one window length).
        const overflowKey = `${namespace}:__overflow__:${limit}:${durationMs}`;
        let overflow = overflowWindows.get(overflowKey);
        if (!overflow || overflow.resetAt <= t) {
          overflow = { count: 0, resetAt: t + durationMs };
          overflowWindows.set(overflowKey, overflow);
        }
        return take(overflow, limit, cost);
      }
      window = { count: 0, resetAt: t + durationMs };
      windows.set(key, window);
      size++;
    }
    return take(window, limit, cost);
  }

  async function rateLimit({ rateLimitingType = "core", identifier, opts }: RateLimitHelper) {
    // Flowko: SMS is a stub in Cal.diy (sms-manager runs this check and sends nothing). A denial would make
    // checkSMSRateLimit lock the user's SMS, or throw from prisma.team.findUnique for sms-manager's
    // "handleSendingSMS:..." identifiers and break the booking emails. Both SMS namespaces keep passing, as before.
    if (rateLimitingType === "sms" || rateLimitingType === "smsMonth") {
      return { success: true, limit: 10, remaining: 999, reset: 0 } as RatelimitResponse;
    }
    if (isIpInBanListString(identifier)) {
      return limitWindow("forcedSlowMode", identifier, opts);
    }
    return limitWindow(rateLimitingType, identifier, opts);
  }

  return Object.assign(rateLimit, { size: () => size });
}

// One store per process, shared by every bundle that imports this module (the pages and app routers).
const globalForRateLimit = globalThis as unknown as { flowkoInMemoryRateLimiter?: InMemoryRateLimiter };

function isTestEnvironment() {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

let warned = false;

export function rateLimiter() {
  const { UNKEY_ROOT_KEY } = process.env;

  if (!UNKEY_ROOT_KEY) {
    // Flowko: suites that book or send codes many times in a row keep the old always-success limiter;
    // rateLimit.test.ts drives the in-memory one through createInMemoryRateLimiter().
    if (isTestEnvironment()) {
      return () => ({ success: true, limit: 10, remaining: 999, reset: 0 }) as RatelimitResponse;
    }
    if (!warned) {
      log.warn("UNKEY_ROOT_KEY is not set, so rate limits are counted in this process only.");
      warned = true;
    }
    // Flowko: fail closed without Unkey. The old always-success limiter left every call site inert here.
    globalForRateLimit.flowkoInMemoryRateLimiter ??= createInMemoryRateLimiter();
    return globalForRateLimit.flowkoInMemoryRateLimiter;
  }
  const timeout = {
    fallback: { success: true, limit: 10, remaining: 999, reset: 0 },
    ms: 5000,
  };

  const onError = (err: Error, identifier: string) => {
    log.error("Unkey rate limiter encountered unknown error", {
      error: err.message,
      stack: err.stack,
      identifier,
      timestamp: new Date().toISOString(),
    });
    return { success: true, limit: 10, remaining: 999, reset: 0 };
  };

  const limiter = {
    core: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "core",
      limit: 10,
      duration: "60s",
      timeout,
      onError,
    }),
    instantMeeting: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "instantMeeting",
      limit: 1,
      duration: "10m",
      timeout,
      onError,
    }),
    common: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "common",
      limit: 200,
      duration: "60s",
      timeout,
      onError,
    }),
    forcedSlowMode: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "forcedSlowMode",
      limit: 1,
      duration: "30s",
      timeout,
      onError,
    }),
    api: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "api",
      limit: API_KEY_RATE_LIMIT,
      duration: "60s",
      timeout,
      onError,
    }),
    ai: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "ai",
      limit: 20,
      duration: "1d",
      timeout,
      onError,
    }),
    sms: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "sms",
      limit: 50,
      duration: "5m",
      timeout,
      onError,
    }),
    smsMonth: new Ratelimit({
      rootKey: UNKEY_ROOT_KEY,
      namespace: "smsMonth",
      limit: 250,
      duration: "30d",
      timeout,
      onError,
    }),
  };

  async function rateLimit({ rateLimitingType = "core", identifier, opts }: RateLimitHelper) {
    if (isIpInBanListString(identifier)) {
      return await limiter.forcedSlowMode.limit(identifier, opts);
    }

    return await limiter[rateLimitingType].limit(identifier, opts);
  }

  return rateLimit;
}
