// Flowko U27: handlers of viewer.flowko.bookings.*. The actor is always ctx.user.id (never from the input); every
// procedure passes the rate limiter first (freeStarts too: it reads Google); service errors map through
// flowkoTrpcError; `needs_confirm` is returned as data, never thrown.
import { getFreeStarts } from "@calcom/features/flowkoBusiness/bookingDay";
import { cancelBusinessBooking, moveBusinessBooking } from "@calcom/features/flowkoBusiness/bookingChange";
import { setBusinessNoShow } from "@calcom/features/flowkoBusiness/bookingNoShow";
import { createBusinessBooking } from "@calcom/features/flowkoBusiness/bookingWriter";
import { findCustomers, getDeskDay, getDeskWeek } from "@calcom/features/flowkoBusiness/desk";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";
import type {
  TCancelBookingInput,
  TCreateBookingInput,
  TCustomersInput,
  TDayInput,
  TFreeStartsInput,
  TMoveBookingInput,
  TNoShowInput,
  TWeekInput,
} from "./bookings.schema";

type Ctx = { user: NonNullable<TrpcSessionUser> };
type Opts<T> = { ctx: Ctx; input: T };

async function limited(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({
    identifier: `flowkoBookings:${ctx.user.id}`,
    rateLimitingType: "common",
  });
}

// Flowko U28 (R13): the desk polls its reads every 30 s, so they have their own bucket and never eat the write one.
async function limitedDesk(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({
    identifier: `flowkoDesk:${ctx.user.id}`,
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
      {
        bookingId: input.bookingId,
        reason: input.reason,
        actorMemberId: input.actorMemberId,
        // Flowko U29e: E6, R10 — only when the client sent it.
        ...(input.handoverToMemberId !== undefined && { handoverToMemberId: input.handoverToMemberId }),
      },
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

// Flowko U28: desk reads (no booking uid in any answer) and the desk's no-show.
export async function dayHandler({ ctx, input }: Opts<TDayInput>) {
  await limitedDesk(ctx);
  return guarded(() => getDeskDay(prisma, ctx.user.id, { date: input.date }, new Date()));
}

export async function weekHandler({ ctx, input }: Opts<TWeekInput>) {
  await limitedDesk(ctx);
  return guarded(() =>
    getDeskWeek(prisma, ctx.user.id, { weekStart: input.weekStart, memberId: input.memberId }, new Date())
  );
}

export async function customersHandler({ ctx, input }: Opts<TCustomersInput>) {
  await limitedDesk(ctx);
  return guarded(() => findCustomers(prisma, ctx.user.id, { query: input.query }));
}

export async function noShowHandler({ ctx, input }: Opts<TNoShowInput>) {
  await limited(ctx);
  return guarded(() =>
    setBusinessNoShow(
      prisma,
      ctx.user.id,
      { bookingId: input.bookingId, noShow: input.noShow, actorMemberId: input.actorMemberId },
      new Date()
    )
  );
}
