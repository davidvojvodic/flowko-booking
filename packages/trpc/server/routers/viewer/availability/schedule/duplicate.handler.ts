import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../../types";
import type { TScheduleDuplicateSchema } from "./duplicate.schema";
import { assertNotMirrorSchedule } from "../../flowko/calScreensGuard"; // Flowko U27

type DuplicateScheduleOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id" | "timeZone">;
  };
  input: TScheduleDuplicateSchema;
};

export type DuplicateScheduleHandlerReturn = Awaited<ReturnType<typeof duplicateHandler>>;

export const duplicateHandler = async ({ ctx, input }: DuplicateScheduleOptions) => {
  // Flowko U27: a worker mirror is never written through Cal's routes, for anyone (the owner included)
  await assertNotMirrorSchedule(input.scheduleId);
  try {
    const { scheduleId } = input;
    const { user } = ctx;
    const schedule = await prisma.schedule.findUnique({
      where: {
        id: scheduleId,
      },
      select: {
        id: true,
        userId: true,
        name: true,
        availability: true,
        timeZone: true,
      },
    });

    if (!schedule || schedule.userId !== user.id) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
      });
    }

    const { availability } = schedule;

    const data: Prisma.ScheduleCreateInput = {
      name: `${schedule.name} (Copy)`,
      user: {
        connect: {
          id: user.id,
        },
      },
      timeZone: schedule.timeZone ?? user.timeZone,
      availability: {
        createMany: {
          data: availability.map((schedule) => ({
            days: schedule.days,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            date: schedule.date,
          })),
        },
      },
    };

    const newSchedule = await prisma.schedule.create({
      data,
    });

    return { schedule: newSchedule };
  } catch (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  }
};
