// Flowko U27: the worker mirror's empty schedule stays out of the availability list.
import { mirrorIdsOfUser } from "@calcom/features/flowkoBusiness/mirror";
import { ScheduleRepository } from "@calcom/features/schedules/repositories/ScheduleRepository";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";

type ListOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id" | "defaultScheduleId">;
  };
};

export type GetAvailabilityListHandlerReturn = Awaited<ReturnType<typeof listHandler>>;

export const listHandler = async ({ ctx }: ListOptions) => {
  const { user } = ctx;

  // Flowko U27: in this handler's own query; an empty result returns before the default-schedule write below.
  const { scheduleIds: mirrorScheduleIds } = await mirrorIdsOfUser(prisma, user.id);

  const schedules = await prisma.schedule.findMany({
    where: {
      userId: user.id,
      ...(mirrorScheduleIds.length > 0 ? { id: { notIn: mirrorScheduleIds } } : {}), // Flowko U27
    },
    select: {
      id: true,
      name: true,
      availability: true,
      timeZone: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  if (schedules.length === 0) {
    return {
      schedules: [],
    };
  }

  let defaultScheduleId: number | null;
  try {
    const scheduleRepository = new ScheduleRepository(prisma);
    defaultScheduleId = await scheduleRepository.getDefaultScheduleId(user.id);
    // Flowko U27: the repository's fallback (first schedule of the user) may be the mirror's empty schedule.
    // The first non-mirror schedule becomes the default instead, as it would for a user without a mirror (M5);
    // schedules is non-empty and has no mirror here.
    if (defaultScheduleId !== null && mirrorScheduleIds.includes(defaultScheduleId)) {
      defaultScheduleId = schedules[0].id;
    }

    if (!user.defaultScheduleId) {
      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          defaultScheduleId,
        },
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    defaultScheduleId = null;
  }

  return {
    schedules: schedules.map((schedule) => ({
      ...schedule,
      isDefault: schedule.id === defaultScheduleId,
    })),
  };
};
