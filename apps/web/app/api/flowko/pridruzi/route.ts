// Flowko U29d (A2): POST /api/flowko/pridruzi, the public accept of an invite (the reset-password pattern, outside
// next-auth's /api/auth/* namespace). Order: strict body → CSRF (validateCsrfToken also refuses a missing cookie
// and deletes it on success) → per-IP limit → a signed-in visitor is refused (never an accept over another
// account) → token shape (no DB) → per-token limit (first 16 hex of its sha256: one token cannot be hammered from
// many IPs) → password rules, then at most 72 UTF-8 bytes (bcrypt reads no more) → acceptInvite. The answer is
// `{}` (201) or `{ code }`; it never echoes the input, the e-mail or the token. Everything after the body parse is
// caught here: defaultResponderForAppDir would log an unknown error, report it to Sentry and echo its message (a
// Prisma message can carry the e-mail), so only a 429 passes through to it and anything unexpected is a 500
// `server_error` with one log line (error name and Prisma code only).
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { validPassword } from "@calcom/features/auth/lib/validPassword";
import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";
import { acceptInvite } from "@calcom/features/flowkoBusiness/inviteAccept";
import { hashInviteToken, isInviteTokenShape } from "@calcom/features/flowkoBusiness/inviteToken";
import { hashPassword } from "@calcom/lib/auth/hashPassword";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import prisma from "@calcom/prisma";
import { validateCsrfToken } from "@calcom/web/lib/validateCsrfToken";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

const log = logger.getSubLogger({ prefix: ["[flowko/pridruzi]"] });

const acceptBodySchema = z
  .object({
    token: z.string().max(64),
    name: z.string().max(200),
    password: z.string().max(200),
    csrfToken: z.string(),
  })
  .strict();

// bcrypt reads the first 72 bytes only: a longer password would be accepted while its tail is ignored.
const BCRYPT_MAX_BYTES = 72;

const answer = (code: string, status: number) => NextResponse.json({ code }, { status });

/** A Prisma error code (P1000-P9999) for the log line, never the message or meta. */
function prismaCode(error: unknown): string | null {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

async function handler(req: NextRequest) {
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    // never log the parser's message: it can quote the body (the password)
    return answer("bad_request", 400);
  }
  const parsed = acceptBodySchema.safeParse(body);
  if (!parsed.success) return answer("bad_request", 400);
  const { token, name, password, csrfToken } = parsed.data;

  try {
    const csrfError = await validateCsrfToken(csrfToken);
    if (csrfError) return csrfError;

    await checkRateLimitAndThrowError({
      rateLimitingType: "core",
      identifier: `flowkoInviteAccept:${piiHasher.hash(getIP(req))}`,
    });

    const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
    if (session?.user) return answer("signed_in", 409);

    if (!isInviteTokenShape(token)) return answer("invite_invalid", 400);
    await checkRateLimitAndThrowError({
      rateLimitingType: "core",
      identifier: `flowkoInviteToken:${hashInviteToken(token).slice(0, 16)}`,
    });

    if (!validPassword(password)) return answer("password_requirements_error", 400);
    if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_BYTES) return answer("password_too_long", 400);

    await acceptInvite({ db: prisma, hashPassword }, { token, name, password }, new Date());
    return NextResponse.json({}, { status: 201 });
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 429) throw error;
    if (error instanceof FlowkoBusinessError) {
      return answer(error.code, error.code === "member_conflict" ? 409 : 400);
    }
    log.error("flowko_invite_accept_failed", {
      error: error instanceof Error ? error.name : "unknown",
      code: prismaCode(error),
    });
    return answer("server_error", 500);
  }
}

export const POST = defaultResponderForAppDir(handler);
