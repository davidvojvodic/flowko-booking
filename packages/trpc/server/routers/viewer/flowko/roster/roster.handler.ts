// Flowko U26: handlers of viewer.flowko.roster.*. The actor is always ctx.user.id (never from the input); every
// mutation passes the rate limiter first; service errors map through flowkoTrpcError.
import {
  addAbsence,
  copyRosterWeek,
  getRosterWeek,
  removeAbsence,
  setHolidayOpen,
  setHolidaysClosed,
  setRosterWeek,
  setUsualWeek,
} from "@calcom/features/flowkoBusiness/roster";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";
import type {
  TAddAbsenceInput,
  TCopyWeekInput,
  TRemoveAbsenceInput,
  TRosterWeekInput,
  TSetHolidayOpenInput,
  TSetHolidaysClosedInput,
  TSetUsualWeekInput,
  TSetWeekInput,
} from "./roster.schema";

type Ctx = { user: NonNullable<TrpcSessionUser> };
type Opts<T> = { ctx: Ctx; input: T };

async function limited(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({ identifier: `flowkoRoster:${ctx.user.id}`, rateLimitingType: "common" });
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

export async function weekHandler({ ctx, input }: Opts<TRosterWeekInput>) {
  return guarded(() => getRosterWeek(prisma, ctx.user.id, input.weekStart));
}

export async function setUsualWeekHandler({ ctx, input }: Opts<TSetUsualWeekInput>) {
  await limited(ctx);
  return guarded(() =>
    setUsualWeek(prisma, ctx.user.id, {
      memberId: input.memberId,
      usualWeek: input.usualWeek,
      confirmOutsideOpening: input.confirmOutsideOpening,
    })
  );
}

export async function setWeekHandler({ ctx, input }: Opts<TSetWeekInput>) {
  await limited(ctx);
  return guarded(() =>
    setRosterWeek(
      prisma,
      ctx.user.id,
      {
        memberId: input.memberId,
        weekStart: input.weekStart,
        days: input.days,
        confirmOutsideOpening: input.confirmOutsideOpening,
      },
      new Date()
    )
  );
}

export async function copyWeekHandler({ ctx, input }: Opts<TCopyWeekInput>) {
  await limited(ctx);
  return guarded(() =>
    copyRosterWeek(
      prisma,
      ctx.user.id,
      { fromWeekStart: input.fromWeekStart, toWeekStart: input.toWeekStart, memberIds: input.memberIds },
      new Date()
    )
  );
}

export async function addAbsenceHandler({ ctx, input }: Opts<TAddAbsenceInput>) {
  await limited(ctx);
  return guarded(() =>
    addAbsence(
      prisma,
      ctx.user.id,
      { memberId: input.memberId, startDate: input.startDate, endDate: input.endDate },
      new Date()
    )
  );
}

export async function removeAbsenceHandler({ ctx, input }: Opts<TRemoveAbsenceInput>) {
  await limited(ctx);
  return guarded(() => removeAbsence(prisma, ctx.user.id, input.absenceId, new Date()));
}

export async function setHolidaysClosedHandler({ ctx, input }: Opts<TSetHolidaysClosedInput>) {
  await limited(ctx);
  return guarded(() => setHolidaysClosed(prisma, ctx.user.id, input.closed));
}

export async function setHolidayOpenHandler({ ctx, input }: Opts<TSetHolidayOpenInput>) {
  await limited(ctx);
  return guarded(() =>
    setHolidayOpen(prisma, ctx.user.id, { date: input.date, open: input.open }, new Date())
  );
}
