import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const BEARER = "Bearer ";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Flowko U22: a cron secret shorter than this is treated as unset. */
export const MIN_CRON_SECRET_LENGTH = 32;

/**
 * Flowko U22: auth for a Flowko cron route, failing closed. Unlike the upstream cron routes it accepts no
 * `?apiKey=` (it would land in access logs), no raw key without `Bearer`, and nothing at all when the secret is
 * unset or short (no `Bearer undefined`). Both sides are hashed first so the constant-time compare never sees
 * buffers of different lengths.
 */
export function isAuthorizedCron(req: NextRequest, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith(BEARER)) return false;

  return timingSafeEqual(sha256(header.slice(BEARER.length)), sha256(secret));
}
