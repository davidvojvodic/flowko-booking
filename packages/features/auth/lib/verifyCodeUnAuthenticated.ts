import { createHash } from "node:crypto";

import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { hashEmail, piiHasher } from "@calcom/lib/server/PiiHasher";
import { totpRawCheck } from "@calcom/lib/totp";
import type { NextApiRequest } from "next";

/**
 * @param req the caller's request, when there is one. The public tRPC procedure must pass it: it is the
 * only caller without an IP limit of its own (the booking routes that also call this limit by IP first).
 */
export const verifyCodeUnAuthenticated = async (
  email: string,
  code: string,
  req?: Request | NextApiRequest
) => {
  if (!email || !code) {
    throw new Error("Email and code are required");
  }

  // Flowko: the limit below is keyed by the email the caller types, so one IP could guess codes for any
  // number of addresses at 10 a minute each (tRPC batching has no size cap). This caps one IP across all
  // emails. It runs first, so a refused call does not use up the email's own attempts. getIP ignores
  // client-sent Cloudflare headers.
  if (req) {
    await checkRateLimitAndThrowError({
      rateLimitingType: "core",
      identifier: `verifyCode-ip:${piiHasher.hash(getIP(req))}`,
    });
  }

  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `emailVerifyCode.${hashEmail(email)}`,
  });

  const secret = createHash("md5")
    .update(email + (process.env.CALENDSO_ENCRYPTION_KEY || ""))
    .digest("hex");

  const isValidToken = totpRawCheck(code, secret, { step: 900 });

  if (!isValidToken) {
    throw new Error("Invalid verification code");
  }

  return true;
};
