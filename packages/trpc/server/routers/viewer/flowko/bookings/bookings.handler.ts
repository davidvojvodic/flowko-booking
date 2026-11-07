// Flowko U27: handlers of viewer.flowko.bookings.*. The actor is always ctx.user.id (never from the input); every
// procedure passes the rate limiter first (freeStarts too: it reads Google); service errors map through
// flowkoTrpcError; `needs_confirm` is returned as data, never thrown.
import { getFreeStarts } from "@calcom/features/flowkoBusiness/bookingDay";
import { cancelBusinessBooking, moveBusinessBooking } from "@calcom/features/flowkoBusiness/bookingChange";
import { createBusinessBooking } from "@calcom/features/flowkoBusiness/bookingWriter";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";
import type {
  TCancelBookingInput,
  TCreateBookingInput,
  TFreeStartsInput,
  TMoveBookingInput,
} from "./bookings.schema";

type Ctx = { user: NonNullable<TrpcSessionUser> };
type Opts<T> = { ctx: Ctx; input: T };

async function limited(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({
    identifier: `flowkoBookings:${ctx.user.id}`,
    rateLimitingType: "common",
  });
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

export async function freeStartsHandler({ ctx, input }: Opts<TFreeStartsInput>) {
  await limited(ctx);
  return guarded(() =>
    getFreeStarts(prisma, ctx.user.id, { date: input.date, serviceIds: input.serviceIds }, new Date())
  );
}

export async function createHandler({ ctx, input }: Opts<TCreateBookingInput>) {
  await limited(ctx);
  return guarded(() =>
    createBusinessBooking(
      prisma,
      ctx.user.id,
      {
        workerMemberId: input.workerMemberId,
        serviceIds: input.serviceIds,
        start: new Date(input.start),
        customer: input.customer,
        confirmOverride: input.confirmOverride,
        actorMemberId: input.actorMemberId,
      },
      new Date()
    )
  );
}

export async function cancelHandler({ ctx, input }: Opts<TCancelBookingInput>) {
  await limited(ctx);
  return guarded(() =>
    cancelBusinessBooking(
      prisma,
      ctx.user.id,
      { bookingId: input.bookingId, reason: input.reason, actorMemberId: input.actorMemberId },
      new Date()
    )
  );
}

export async function moveHandler({ ctx, input }: Opts<TMoveBookingInput>) {
  await limited(ctx);
  return guarded(() =>
    moveBusinessBooking(
      prisma,
      ctx.user.id,
      {
        bookingId: input.bookingId,
        start: new Date(input.start),
        confirmOverride: input.confirmOverride,
        actorMemberId: input.actorMemberId,
      },
      new Date()
    )
  );
}
