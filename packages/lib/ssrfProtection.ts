import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { IS_SELF_HOSTED } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";

const log: ReturnType<typeof logger.getSubLogger> = logger.getSubLogger({ prefix: ["ssrf-protection"] });

/**
 * SSRF protection helpers for server-side URL fetching
 *
 * Use when fetching user-controlled URLs (logos, avatars, webhooks) to prevent
 * access to internal networks and cloud metadata services
 */

// Flowko: an address is allowed only when ipaddr.js labels it "unicast" (global unicast). This replaces
// the upstream blocklist (unspecified, loopback, private, linkLocal, uniqueLocal, carrierGradeNat,
// reserved, benchmarking), which let multicast, broadcast, discard, Teredo, NAT64 and 6to4 through.
const ALLOWED_IP_RANGE = "unicast";

// Cloud metadata endpoints (blocked even on self-hosted)
const CLOUD_METADATA_ENDPOINTS: string[] = [
  "169.254.169.254", // AWS/Azure/DigitalOcean/Oracle metadata
  "169.254.169.253", // Azure alternate
  "metadata.google.internal", // GCP metadata
  "metadata.google.com", // GCP alternate
];

const LOOPBACK_HOSTNAMES: string[] = ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"];

// Hostnames blocked on Cal.diy SaaS (includes metadata + loopback)
const BLOCKED_HOSTNAMES: string[] = [...CLOUD_METADATA_ENDPOINTS, ...LOOPBACK_HOSTNAMES];

const CAL_AVATAR_PATH_REGEX = /^\/api\/avatar\/.+\.png$/;

const ERRORS = {
  HTTPS_ONLY: "Only HTTPS URLs are allowed",
  INVALID_PROTOCOL: "Only HTTP and HTTPS protocols are allowed",
  PRIVATE_IP: "Private IP address",
  PRIVATE_IP_DNS: "Hostname resolves to private IP",
  BLOCKED_HOSTNAME: "Blocked hostname",
  INVALID_URL: "Invalid URL format",
  NON_IMAGE_DATA_URL: "Non-image data URL",
} as const;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function stripIPv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

// Flowko: the IPv4 address an IPv6 translation/tunnel address carries (IPv4-mapped, SIIT, NAT64 well-known
// prefix, 6to4), so the embedded address is what gets checked.
function embeddedIPv4(ipv6: ipaddr.IPv6): ipaddr.IPv4 | null {
  const p = ipv6.parts;
  const fromWords = (hi: number, lo: number) => new ipaddr.IPv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  switch (ipv6.range()) {
    case "ipv4Mapped": // ::ffff:a.b.c.d
    case "rfc6145": // ::ffff:0:a.b.c.d
    case "rfc6052": // 64:ff9b::a.b.c.d
      return fromWords(p[6], p[7]);
    case "6to4": // 2002:aabb:ccdd::/48
      return fromWords(p[1], p[2]);
    default:
      return null;
  }
}

// Flowko: IPv4-compatible ::a.b.c.d (deprecated) and the local-use NAT64 prefix 64:ff9b:1::/48 are not
// globally reachable, but ipaddr.js labels both "unicast".
const NON_GLOBAL_IPV6_CIDRS: ReadonlyArray<[ipaddr.IPv6, number]> = [
  [ipaddr.IPv6.parse("::"), 96],
  [ipaddr.IPv6.parse("64:ff9b:1::"), 48],
];

export function isPrivateIP(ip: string): boolean {
  const cleanIp = stripIPv6Brackets(ip);

  if (!ipaddr.isValid(cleanIp)) {
    return true;
  }

  try {
    const addr = ipaddr.parse(cleanIp);

    // Flowko: allowlist (see ALLOWED_IP_RANGE); an IPv6 address that embeds an IPv4 one is judged by it
    if (addr.kind() === "ipv6") {
      const ipv6 = addr as ipaddr.IPv6;
      const ipv4 = embeddedIPv4(ipv6);
      if (ipv4) {
        return ipv4.range() !== ALLOWED_IP_RANGE;
      }
      if (NON_GLOBAL_IPV6_CIDRS.some((cidr) => ipv6.match(cidr))) {
        return true;
      }
    }

    return addr.range() !== ALLOWED_IP_RANGE;
  } catch {
    // If parsing fails, treat as blocked for safety
    return true;
  }
}

// Check if hostname is a blocked cloud metadata endpoint or localhost
export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return BLOCKED_HOSTNAMES.includes(normalized);
}

// Check if hostname is a cloud metadata endpoint (blocked even on self-hosted)
function isCloudMetadataEndpoint(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return CLOUD_METADATA_ENDPOINTS.includes(normalized);
}

export interface SSRFValidationResult {
  isValid: boolean;
  error?: string;
}

// Flowko: allowHttp is for re-checking a URL that was already validated when it was saved (webhook
// delivery). It lets plain http: through, but every loopback, private and metadata check still runs.
export interface SSRFValidationOptions {
  allowHttp?: boolean;
}

/**
 * Core validation logic shared by sync and async versions
 * Returns SSRFValidationResult if validation completes, or { url } if DNS check is needed
 */
function validateUrlCore(
  urlString: string,
  options?: SSRFValidationOptions
): SSRFValidationResult | { url: URL } {
  // Data URLs with image/* are safe (no network fetch)
  if (urlString.startsWith("data:image/")) {
    return { isValid: true };
  }

  if (urlString.startsWith("data:")) {
    return { isValid: false, error: ERRORS.NON_IMAGE_DATA_URL };
  }

  if (CAL_AVATAR_PATH_REGEX.test(urlString)) {
    return { isValid: true };
  }

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { isValid: false, error: ERRORS.INVALID_URL };
  }

  // E2E tests: allow localhost only
  if (process.env.NEXT_PUBLIC_IS_E2E === "1") {
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (isLocalhost) {
      return { isValid: true };
    }
  }

  // Always block cloud metadata endpoints (even self-hosted may run on AWS/GCP/Azure)
  if (isCloudMetadataEndpoint(url.hostname)) {
    return { isValid: false, error: ERRORS.BLOCKED_HOSTNAME };
  }

  // Self-hosted: allow HTTP and private IPs (for internal webhooks)
  // Still restrict to HTTP/HTTPS protocols only (no file://, ftp://, etc.)
  // Flowko: booking.flowko.si is multi-tenant, so IS_SELF_HOSTED alone must not open the private
  // network (loopback, RFC1918, *.railway.internal, metadata via IPv4-mapped IPv6 or DNS). The
  // upstream self-hosted behaviour needs an explicit operator opt-in; default off = SaaS checks.
  if (IS_SELF_HOSTED && process.env.FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS === "true") {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { isValid: false, error: ERRORS.INVALID_PROTOCOL };
    }
    return { isValid: true };
  }

  if (url.protocol !== "https:" && !(options?.allowHttp && url.protocol === "http:")) {
    return { isValid: false, error: ERRORS.HTTPS_ONLY };
  }

  if (isBlockedHostname(url.hostname)) {
    return { isValid: false, error: ERRORS.BLOCKED_HOSTNAME };
  }

  // Check if hostname is an IP address and if it's private
  const hostnameForIPCheck = stripIPv6Brackets(url.hostname);
  if (ipaddr.isValid(hostnameForIPCheck) && isPrivateIP(hostnameForIPCheck)) {
    return { isValid: false, error: ERRORS.PRIVATE_IP };
  }

  return { url };
}

/**
 * Async SSRF validation with DNS rebinding protection
 * Resolves hostname and checks all IPs against private ranges
 */
export async function validateUrlForSSRF(
  urlString: string,
  options?: SSRFValidationOptions
): Promise<SSRFValidationResult> {
  const result = validateUrlCore(urlString, options);

  if ("isValid" in result) {
    return result;
  }

  // DNS rebinding protection: resolve IPs and check each one
  try {
    const addresses = await dns.lookup(result.url.hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIP(address)) {
        return { isValid: false, error: ERRORS.PRIVATE_IP_DNS };
      }
    }
  } catch {
    // Allow DNS failures to avoid breaking legitimate hosts with flaky DNS
  }

  return { isValid: true };
}

/**
 * Sync SSRF validation for Zod schemas (no DNS check)
 * Does not protect against DNS rebinding - use async version when possible
 */
export function validateUrlForSSRFSync(urlString: string): SSRFValidationResult {
  const result = validateUrlCore(urlString);

  if ("isValid" in result) {
    return result;
  }

  return { isValid: true };
}

// Check if URL belongs to the same origin as the webapp (trusted internal URL)
export function isTrustedInternalUrl(url: string, webappUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(webappUrl).origin;
  } catch {
    return false;
  }
}

// Sanitize URL for logging - removes query params and credentials that may contain secrets
function sanitizeUrlForLog(urlString: string): string {
  try {
    const url = new URL(urlString);
    // Only log origin + pathname, exclude query params, hash, and credentials
    return `${url.origin}${url.pathname}`.substring(0, 100);
  } catch {
    // If URL parsing fails, truncate and redact potential secrets
    return `${urlString.substring(0, 50).replace(/[?#].*$/, "")}...`;
  }
}

// Log blocked SSRF attempts for security monitoring and incident response
export function logBlockedSSRFAttempt(url: string, reason: string, context?: Record<string, unknown>): void {
  log.warn("SSRF attempt blocked", {
    url: sanitizeUrlForLog(url),
    reason,
    ...context,
  });
}
