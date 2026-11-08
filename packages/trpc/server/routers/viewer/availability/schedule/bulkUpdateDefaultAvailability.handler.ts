import { prisma } from "@calcom/prisma";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../../types";
import { assertNotMirrorEventTypeWrite, assertNotMirrorSchedule } from "../../flowko/calScreensGuard"; // Flowko U27
import type { TBulkUpdateToDefaultAvailabilityInputSchema } from "./bulkUpdateDefaultAvailability.schema";

type BulkUpdateToDefaultAvailabilityOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TBulkUpdateToDefaultAvailabilityInputSchema;
};

export const bulkUpdateToDefaultAvailabilityHandler = async ({
  ctx,
  input,
}: BulkUpdateToDefaultAvailabilityOptions) => {
  const { eventTypeIds, selectedDefaultScheduleId } = input;
  // Flowko U27: a worker mirror (its event type, or its schedule as the new default) is never written through
  // Cal's routes, for anyone (the owner included). The whole call is refused before any write
  await assertNotMirrorEventTypeWrite(eventTypeIds);
  if (selectedDefaultScheduleId) await assertNotMirrorSchedule(selectedDefaultScheduleId);
  const defaultScheduleId = ctx.user.defaultScheduleId;

  if (!selectedDefaultScheduleId && !defaultScheduleId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Default schedule not set",
    });
  }

  const scheduleId = selectedDefaultScheduleId || defaultScheduleId;

  // Flowko: schedule ids are sequential, and binding another tenant's schedule to the caller's event types
  // showed that tenant's working hours, date overrides and timezone in their slots. A missing schedule gets
  // the same FORBIDDEN, so the call does not tell which ids exist
  const ownSchedule = scheduleId
    ? await prisma.schedule.findFirst({
        where: { id: scheduleId, userId: ctx.user.id },
        select: { id: true },
      })
    : null;
  if (!ownSchedule) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  return await prisma.eventType.updateMany({
    where: {
      id: {
        in: eventTypeIds,
      },
      userId: ctx.user.id,
    },
    data: {
      scheduleId: ownSchedule.id,
    },
  });
};
