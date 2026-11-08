// Flowko U27: Cal's own write routes for event types, schedules, out-of-office and holidays are refused for a WORKER
// or STAFF member of a business (D2): the business owner configures the business, and a salon worker's Cal is only
// the bookings list. A worker mirror (hidden event type + its empty schedule) is refused for EVERYONE, the owner
// included: editing the schedule would give the mirror live slots, and deleting the schedule cascades the mirror row
// and leaves an orphan hidden event type with live slots. The message is a code only, never an id or a slug.
// Uses the global client (the Cal handlers have no `db`). Server only.
import {
  mirrorOfEventType,
  mirrorOfSchedule,
  nonOwnerMemberOf,
} from "@calcom/features/flowkoBusiness/mirror";
import { prisma } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";

/** The code a non-owner member gets from a guarded Cal screen route. */
export const FLOWKO_CAL_SCREEN = "flowko_cal_screen";
/** The code anyone gets when a Cal write route names a worker mirror (its event type or its schedule). */
export const FLOWKO_MIRROR_WRITE = "flowko_mirror_write";

/**
 * D2: tRPC middleware for the listed Cal write procedures (`.use(flowkoCalScreensGuard)` after the authed
 * procedure); the owner and a user in no business pass through. A plain function, not a `middleware()` builder:
 * the builder's context type would not accept the authed procedure's extended context.
 */
export async function flowkoCalScreensGuard<TResult>({
  ctx,
  next,
}: {
  ctx: { user: { id: number } };
  next: () => Promise<TResult>;
}): Promise<TResult> {
  if (await nonOwnerMemberOf(prisma, ctx.user.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: FLOWKO_CAL_SCREEN });
  }
  return next();
}

/** A mirror event type is never written through Cal's routes. A list is refused whole if any id is a mirror. */
export async function assertNotMirrorEventTypeWrite(eventTypeIds: number | number[]): Promise<void> {
  const ids = Array.from(new Set(Array.isArray(eventTypeIds) ? eventTypeIds : [eventTypeIds]));
  const mirrors = await Promise.all(ids.map((id) => mirrorOfEventType(prisma, id)));
  if (mirrors.some(Boolean)) {
    throw new TRPCError({ code: "FORBIDDEN", message: FLOWKO_MIRROR_WRITE });
  }
}

/** A mirror's schedule is never updated, duplicated, deleted or used as a default through Cal's routes. */
export async function assertNotMirrorSchedule(scheduleId: number): Promise<void> {
  if (await mirrorOfSchedule(prisma, scheduleId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: FLOWKO_MIRROR_WRITE });
  }
}
