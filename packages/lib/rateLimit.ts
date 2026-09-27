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
 * Flowko: the in-memory store's bounds. A live window is never dropped to make room, because then anyone could
 * reset every counter (a denying one included) by flooding the store with fresh identifiers. A new identifier
 * that finds no room is counted in its namespace's overflow window instead (fail closed).
 *
 * A namespace is one call site's limiter: the rate-limiting type plus the fixed labels in front of the
 * identifier (see getRateLimitNamespace), e.g. "core:login" or "core:emailVerifyCode". Each has its own budget
 * of live windows, so a flood of fresh identifiers at one limiter (random e-mails at the email-code or the
 * sign-in check) can only degrade that limiter; a host signing in or a booker booking still gets a window of
 * their own. U8e: before, one global budget of 50,000 was shared, and a flood in any namespace sent every new
 * identifier of every other namespace into that namespace's shared overflow window.
 *
 * Memory: one window is about 330 bytes (V8, 2026-09-27). One namespace holds at most
 * IN_MEMORY_RATE_LIMIT_MAX_ENTRIES_PER_NAMESPACE windows (about 16 MB, the old global cap), all of them
 * together IN_MEMORY_RATE_LIMIT_MAX_ENTRIES (about 33 MB) plus at most the reserve below for each namespace
 * (IN_MEMORY_RATE_LIMIT_MAX_NAMESPACES plus one per rate-limiting type).
 */
export const IN_MEMORY_RATE_LIMIT_MAX_ENTRIES_PER_NAMESPACE = 50_000;
export const IN_MEMORY_RATE_LIMIT_MAX_ENTRIES = 100_000;
/**
 * Flowko: once all namespaces together hold IN_MEMORY_RATE_LIMIT_MAX_ENTRIES windows (floods in two or more
 * namespaces at once), a namespace still gets this many windows of its own, so a quiet limiter keeps working.
 */
export const IN_MEMORY_RATE_LIMIT_RESERVED_ENTRIES_PER_NAMESPACE = 1_000;
/**
 * Flowko: the labels come from code, so the call sites make a few dozen namespaces. Past this many, a new
 * namespace (a future call site that puts client-chosen text first) counts in its type's unlabelled namespace,
 * which keeps the namespace bookkeeping, and with it the memory bound above, finite.
 */
export const IN_MEMORY_RATE_LIMIT_MAX_NAMESPACES = 64;

// A label is a word: a hash, an id, an IP address or an e-mail has a digit, "@" or "." in it and ends the prefix.
const NAMESPACE_LABEL = /^[A-Za-z][A-Za-z_-]{0,47}$/;
const MAX_NAMESPACE_LABELS = 3;

/**
 * Flowko: the namespace an identifier is counted in: its rate-limiting type plus the word labels its call site
 * puts in front of the variable part, split at ":" and ".":
 * `login:<email hash>:<ip hash>` → "core:login", `api:cancel-ip:<ip hash>` → "core:api:cancel-ip",
 * `emailVerifyCode.<email hash>` → "core:emailVerifyCode". The last segment is always the variable part, so a
 * bare identifier (a hash, an IP address) is counted under its type alone.
 */
export function getRateLimitNamespace(rateLimitingType: RateLimitingType, identifier: string): string {
  const segments = identifier.split(/[:.]/);
  const labels: string[] = [];
  for (let i = 0; i < segments.length - 1 && labels.length < MAX_NAMESPACE_LABELS; i++) {
    if (!NAMESPACE_LABEL.test(segments[i])) break;
    labels.push(segments[i]);
  }
  return [rateLimitingType, ...labels].join(":");
}

const DURATION_UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// Same parser as @unkey/ratelimit's, so an opts.limit override means the same on both paths.
function durationToMs(duration: string | number): number {
  if (typeof duration === "number") return duration;
  const match = duration.match(/^(\d+)\s?(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Unable to parse window size: ${duration}`);
  return Number.parseInt(match[1], 10) * DURATION_UNIT_MS[match[2] as keyof typeof DURATION_UNIT_MS];
}

export type InMemoryRateLimiter = (helper: RateLimitHelper) => Promise<RatelimitResponse>;

// The live windows a namespace holds
type Namespace = { size: number };
type Window = { count: number; resetAt: number };
type LiveWindow = Window & { namespace: Namespace };

/**
 * Flowko: an in-process fixed-window limiter with the same limits, keys and response shape as the Unkey path.
 * Without it every checkRateLimitAndThrowError call site (booking, cancel, forgot/reset password, 2FA, email
 * codes, login) passes unconditionally when UNKEY_ROOT_KEY is unset. booking.flowko.si runs one web replica,
 * so per-process counters are exact there; they reset on every deploy. Memory stays bounded: expired windows
 * are pruned on every call, and a new identifier whose namespace is full (`maxEntriesPerNamespace`), or whose
 * namespace has used its reserve while the whole store is full (`maxEntries`), shares its namespace's overflow
 * window (fail closed) instead of evicting anyone's live window.
 * Exported so tests can drive it with their own clock and bounds; production code gets it through rateLimiter().
 */
export function createInMemoryRateLimiter({
  maxEntries = IN_MEMORY_RATE_LIMIT_MAX_ENTRIES,
  maxEntriesPerNamespace = IN_MEMORY_RATE_LIMIT_MAX_ENTRIES_PER_NAMESPACE,
  reservedEntriesPerNamespace = IN_MEMORY_RATE_LIMIT_RESERVED_ENTRIES_PER_NAMESPACE,
  maxNamespaces = IN_MEMORY_RATE_LIMIT_MAX_NAMESPACES,
  now = Date.now,
}: {
  maxEntries?: number;
  maxEntriesPerNamespace?: number;
  reservedEntriesPerNamespace?: number;
  maxNamespaces?: number;
  now?: () => number;
} = {}): InMemoryRateLimiter & { size: () => number } {
  // One Map per window length. Within one, insertion order is resetAt order (an expired window is deleted
  // before its key is set again), so expired windows sit at the front and pruning stops at the first live
  // one: it costs only what it removes, which is why it can run on every call. Each window points at its
  // namespace, so pruning also keeps the namespace's count in O(1).
  const windowsByDuration = new Map<number, Map<string, LiveWindow>>();
  // At most one per namespace + limit + duration, all of which are bounded or fixed in code, so this stays small.
  const overflowWindows = new Map<string, Window>();
  // Namespace key → its live-window count. Labelled namespaces are capped at maxNamespaces; the unlabelled
  // one of each type (at most one per rate-limiting type) is always available.
  const namespaces = new Map<string, Namespace>();
  let labelledNamespaceCount = 0;
  let size = 0;
  let banListWarned = false;

  function removeWindow(windows: Map<string, LiveWindow>, key: string, window: LiveWindow) {
    windows.delete(key);
    size--;
    window.namespace.size--;
  }

  function pruneExpired(t: number) {
    windowsByDuration.forEach((windows) => {
      const entries = windows.entries();
      let entry = entries.next();
      while (!entry.done && entry.value[1].resetAt <= t) {
        removeWindow(windows, entry.value[0], entry.value[1]);
        entry = entries.next();
      }
    });
  }

  function namespaceOf(type: RateLimitingType, identifier: string): { key: string; namespace: Namespace } {
    let key = getRateLimitNamespace(type, identifier);
    let namespace = namespaces.get(key);
    if (namespace) return { key, namespace };
    const isLabelled = key !== type;
    if (isLabelled && labelledNamespaceCount >= maxNamespaces) {
      key = type;
      namespace = namespaces.get(key);
      if (namespace) return { key, namespace };
    } else if (isLabelled) {
      labelledNamespaceCount++;
    }
    namespace = { size: 0 };
    namespaces.set(key, namespace);
    return { key, namespace };
  }

  function hasRoomFor(namespace: Namespace) {
    if (namespace.size >= maxEntriesPerNamespace) return false;
    return size < maxEntries || namespace.size < reservedEntriesPerNamespace;
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
      removeWindow(windows, key, window);
      window = undefined;
    }
    if (!window) {
      const { key: namespaceKey, namespace: owner } = namespaceOf(namespace, identifier);
      if (!hasRoomFor(owner)) {
        // Flowko: no room for another live window. Evicting one would reset its counter, so a flood of
        // fresh identifiers could reset a denying login or code window. Fail closed instead: every
        // identifier that is new while its namespace has no room shares that namespace's overflow window,
        // with the limiter's own limit, until pruning frees room (at most one window length). U8e: per
        // namespace, so other limiters keep their own windows.
        const overflowKey = `${namespaceKey}:__overflow__:${limit}:${durationMs}`;
        let overflow = overflowWindows.get(overflowKey);
        if (!overflow || overflow.resetAt <= t) {
          overflow = { count: 0, resetAt: t + durationMs };
          overflowWindows.set(overflowKey, overflow);
        }
        return take(overflow, limit, cost);
      }
      window = { count: 0, resetAt: t + durationMs, namespace: owner };
      windows.set(key, window);
      size++;
      owner.size++;
    }
    return take(window, limit, cost);
  }

  function isBanned(identifier: string) {
    try {
      return isIpInBanListString(identifier);
    } catch (error) {
      // Flowko: without Unkey a malformed IP_BANLIST used to be harmless (it was never read). It must not
      // turn every limited endpoint into a 500 now; the limits themselves still apply.
      if (!banListWarned) {
        log.error("IP_BANLIST is not a JSON array of strings, so it is ignored.", {
          error: error instanceof Error ? error.message : String(error),
        });
        banListWarned = true;
      }
      return false;
    }
  }

  async function rateLimit({ rateLimitingType = "core", identifier, opts }: RateLimitHelper) {
    // Flowko: SMS is a stub in Cal.diy (sms-manager runs this check and sends nothing). A denial would make
    // checkSMSRateLimit lock the user's SMS, or throw from prisma.team.findUnique for sms-manager's
    // "handleSendingSMS:..." identifiers and break the booking emails. Both SMS namespaces keep passing, as before.
    if (rateLimitingType === "sms" || rateLimitingType === "smsMonth") {
      return { success: true, limit: 10, remaining: 999, reset: 0 } as RatelimitResponse;
    }
    if (isBanned(identifier)) {
      return limitWindow("forcedSlowMode", identifier, opts);
    }
    return limitWindow(rateLimitingType, identifier, opts);
  }

  return Object.assign(rateLimit, { size: () => size });
}

// One store per process, shared by every bundle that imports this module (the pages and app routers).
const globalForRateLimit = globalThis as unknown as { flowkoInMemoryRateLimiter?: InMemoryRateLimiter };

// Flowko: NEXT_PUBLIC_IS_E2E is set only by the Playwright web server (playwright.config.ts), where every
// worker books from 127.0.0.1 and would share one IP bucket. It already skips the admin password/2FA rule
// and Turnstile, so it is never set on Railway (the Dockerfile and build-image.yml do not set it).
function isTestEnvironment() {
  return (
    Boolean(process.env.VITEST) || process.env.NODE_ENV === "test" || Boolean(process.env.NEXT_PUBLIC_IS_E2E)
  );
}

let warned = false;

export function rateLimiter() {
  const { UNKEY_ROOT_KEY } = process.env;

  if (!UNKEY_ROOT_KEY) {
    // Flowko: unit and e2e suites that book or send codes many times in a row keep the old always-success
    // limiter; rateLimit.test.ts drives the in-memory one through createInMemoryRateLimiter().
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
