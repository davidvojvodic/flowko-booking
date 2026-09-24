import { handleMarkHostNoShow } from "@calcom/features/handleMarkNoShow";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { prisma } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import type { NextApiRequest } from "next";

import { TRPCError } from "@trpc/server";

import type { TRPCContext } from "../../createContext";
import type { TNoShowInputSchema } from "./markHostAsNoShow.schema";

type NoShowOptions = {
  ctx: { req?: TRPCContext["req"] };
  input: TNoShowInputSchema;
};

// TODO: Track which attendee actually called this endpoint to mark host as no-show.
// Currently this is completely anonymous and public endpoint.
export const noShowHandler = async ({ ctx, input }: NoShowOptions) => {
  const { bookingUid, noShowHost } = input;

  // Flowko: anonymous and uid-only, so throttle it per IP. Unthrottled, it answered many uid guesses per request.
  const ip = ctx.req ? getIP(ctx.req as NextApiRequest) : "unknown";
  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `markHostAsNoShow:${piiHasher.hash(ip)}`,
  });

  // Flowko: an attendee can only report that the host did not show up, once the meeting has started (the
  // attendee path's rule in handleMarkNoShow.ts). Clearing the flag, or setting it on a booking that is not
  // accepted or has not started, is refused. Missing, not accepted and not started all get the same answer,
  // so the error does not tell a caller whether a uid exists.
  const booking =
    noShowHost === true
      ? await prisma.booking.findUnique({
          where: { uid: bookingUid },
          select: { status: true, startTime: true },
        })
      : null;
  if (!booking || booking.status !== BookingStatus.ACCEPTED || new Date() < new Date(booking.startTime)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Failed to update no-show status" });
  }

  return handleMarkHostNoShow({
    bookingUid,
    noShowHost: true,
  });
};

export default noShowHandler;
