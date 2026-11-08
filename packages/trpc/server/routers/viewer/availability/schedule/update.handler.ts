import { updateSchedule } from "@calcom/features/schedules/services/ScheduleService";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import type { TUpdateInputSchema } from "./update.schema";
import { assertNotMirrorSchedule } from "../../flowko/calScreensGuard"; // Flowko U27

type User = NonNullable<TrpcSessionUser>;
type UpdateOptions = {
  ctx: {
    user: { id: User["id"]; defaultScheduleId: User["defaultScheduleId"]; timeZone: User["timeZone"] };
  };
  input: TUpdateInputSchema;
};

export const updateHandler = async ({ input, ctx }: UpdateOptions) => {
  const { user } = ctx;
  // Flowko U27: a worker mirror is never written through Cal's routes, for anyone (the owner included)
  await assertNotMirrorSchedule(input.scheduleId);
  return updateSchedule({
    input,
    user,
    prisma,
  });
};
