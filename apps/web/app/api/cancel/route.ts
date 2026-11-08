import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import handleCancelBooking from "@calcom/features/bookings/lib/handleCancelBooking";
// Flowko U27: a business booking's cancel link goes to Flowko's step-aware customer cancel (W8)
import { cancelBusinessBookingAsCustomer } from "@calcom/features/flowkoBusiness/bookingChange";
import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";
import { businessBookingByUid } from "@calcom/features/flowkoBusiness/mirror";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import prisma from "@calcom/prisma"; // Flowko U27
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

  // Flowko U27 (W8): after CSRF and the rate limit, a business booking is cancelled by Flowko's customer cancel
  // (step-aware; staff cancel for a member who may act on it), never by handleCancelBooking, which refuses it.
  // Its refusals answer 400 with the code as message (the cancel form shows data.message).
  const businessBooking = await businessBookingByUid(prisma, bookingData.uid);
  if (businessBooking) {
    try {
      await cancelBusinessBookingAsCustomer(
        prisma,
        {
          uid: businessBooking.uid,
          reason: bookingData.cancellationReason ?? null,
          sessionUserId: session?.user?.id ?? null,
        },
        new Date()
      );
    } catch (error) {
      if (error instanceof FlowkoBusinessError) {
        return NextResponse.json({ success: false, message: error.code }, { status: 400 });
      }
      throw error;
    }
    return NextResponse.json(
      {
        success: true,
        message: "Booking successfully cancelled.",
        onlyRemovedAttendee: false,
        bookingId: businessBooking.bookingId,
        bookingUid: businessBooking.uid,
        isPlatformManagedUserBooking: false,
      },
      { status: 200 }
    );
  }

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
