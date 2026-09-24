import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import handleCancelBooking from "@calcom/features/bookings/lib/handleCancelBooking";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { bookingCancelWithCsrfSchema } from "@calcom/prisma/zod-utils";
import { validateCsrfToken } from "@calcom/web/lib/validateCsrfToken";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

// Flowko: not exported, because a route file may export only route handlers and route config.
const SIGNED_IN_CANCEL_RATE_LIMIT = { limit: 60, duration: "60s" } as const;

async function handler(req: NextRequest) {
  let appDirRequestBody;
  try {
    appDirRequestBody = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
  }
  const bookingData = bookingCancelWithCsrfSchema.parse(appDirRequestBody);

  // Integer IDs are sequential/guessable — only accept high-entropy UIDs on this route
  if (!bookingData.uid) {
    return NextResponse.json(
      { success: false, message: "uid is required for booking cancellation" },
      { status: 400 }
    );
  }

  const csrfError = await validateCsrfToken(bookingData.csrfToken);
  if (csrfError) {
    return csrfError;
  }

  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });

  // Rate limit: 60 booking cancellations per 60 seconds per user (or 10 per IP if not authenticated)
  const identifier = session?.user?.id
    ? `api:cancel-user:${session.user.id}`
    : `api:cancel-ip:${piiHasher.hash(getIP(req))}`;
  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier,
    // Flowko: a signed-in host may cancel 60 bookings a minute (David's decision), so clearing a busy day
    // does not hit the limit. Anonymous callers keep the core default, 10 a minute per IP.
    opts: session?.user?.id ? { limit: SIGNED_IN_CANCEL_RATE_LIMIT } : undefined,
  });

  // Strip integer id to ensure lookup is always by uid
  const { id: _id, ...safeBookingData } = bookingData;

  const result = await handleCancelBooking({
    bookingData: safeBookingData,
    userId: session?.user?.id || -1,
  });

  // const bookingCancelService = getBookingCancelService();
  // const result = await bookingCancelService.cancelBooking({
  //   bookingData: bookingData,
  //   bookingMeta: {
  //     userId: session?.user?.id || -1,
  //   },
  // });

  const statusCode = result.success ? 200 : 400;

  return NextResponse.json(result, { status: statusCode });
}

export const DELETE = defaultResponderForAppDir(handler);
export const POST = defaultResponderForAppDir(handler);
