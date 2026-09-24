import process from "node:process";
import type { NextApiRequest } from "next";
import z from "zod";
import logger from "./logger";

export function parseIpFromHeaders(value: string | string[]) {
  const rawIp = Array.isArray(value) ? value[0] : value.split(",")[0];
  return rawIp?.trim() ?? "";
}


// Flowko: headers only Cloudflare's edge sets. Without Cloudflare in front they arrive straight from the client.
const CLOUDFLARE_IP_HEADERS: readonly string[] = ["cf-connecting-ip", "true-client-ip"];
const PROXY_IP_HEADERS: readonly string[] = ["x-forwarded-for", "x-real-ip"];

/**
 * Tries to extract IP address from a request.
 *
 * Header priority:
 *  1. cf-connecting-ip  – set by Cloudflare with the real client IP
 *  2. true-client-ip    – set by Cloudflare (Enterprise / Managed Transforms)
 *     (1 and 2 are read ONLY when TRUST_CLOUDFLARE_IP_HEADERS === "true")
 *  3. x-forwarded-for   – first IP is the real client; the platform edge (Railway)
 *                         controls the first hop
 *  4. x-real-ip         – set by the proxy to the *connecting* IP (least reliable)
 *
 * @see https://github.com/vercel/examples/blob/main/edge-functions/ip-blocking/lib/get-ip.ts
 **/
export default function getIP(request: Request | NextApiRequest) {
  // Flowko: booking.flowko.si has no Cloudflare in front, so a client-sent cf-connecting-ip /
  // true-client-ip would let any caller mint a fresh rate-limit identifier per request. Ignore them
  // unless the operator opts in (read per call, fail closed: anything but "true" means ignored).
  const headers: readonly string[] =
    process.env.TRUST_CLOUDFLARE_IP_HEADERS === "true"
      ? [...CLOUDFLARE_IP_HEADERS, ...PROXY_IP_HEADERS]
      : PROXY_IP_HEADERS;

  for (const header of headers) {
    const value = request instanceof Request ? request.headers.get(header) : request.headers[header];
    if (value) {
      return parseIpFromHeaders(value);
    }
  }

  return "127.0.0.1";
}

const banlistSchema = z.array(z.string());

export function isIpInBanlist(request: Request | NextApiRequest) {
  const IP = getIP(request);
  const rawBanListJson = process.env.IP_BANLIST || "[]";
  const banList = banlistSchema.parse(JSON.parse(rawBanListJson));
  if (banList.includes(IP)) {
    logger.warn(`Found banned IP: ${IP} in IP_BANLIST`);
    return true;
  }
  return false;
}

export function isIpInBanListString(identifer: string) {
  const rawBanListJson = process.env.IP_BANLIST || "[]";
  const banList = banlistSchema.parse(JSON.parse(rawBanListJson));
  if (banList.includes(identifer)) {
    logger.warn(`Found banned IP: ${identifer} in IP_BANLIST`);
    return true;
  }
  return false;
}