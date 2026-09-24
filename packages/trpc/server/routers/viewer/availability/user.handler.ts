import { isActiveInstanceAdmin } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { findUsersForAvailabilityCheck } from "@calcom/features/availability/lib/findUsersForAvailabilityCheck";
import { getUserAvailabilityService } from "@calcom/features/di/containers/GetUserAvailability";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { TRPCError } from "@trpc/server";
import type { TrpcSessionUser } from "../../../types";
import type { TUserInputSchema } from "./user.schema";

type UserOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TUserInputSchema;
};

function getUser(where: Prisma.UserWhereInput) {
  return findUsersForAvailabilityCheck({
    where,
  });
}

export const userHandler = async ({ ctx, input }: UserOptions) => {
  // Flowko: every client business is its own user on this instance, so a user reads only their own
  // availability (busy times with calendar event titles, schedules, out of office). An admin may read anyone's,
  // but only an active one: an ADMIN without 2FA is an INACTIVE_ADMIN at sign-in, while the database says ADMIN.
  const isAdmin = isActiveInstanceAdmin(ctx.user);
  if (!isAdmin && input.username !== ctx.user.username) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  // The event type picks the schedule and the booking limits that are read, so it has to be the user's own too
  if (!isAdmin && input.eventTypeId) {
    const eventType = await new EventTypeRepository(prisma).findByIdWithUserAccess({
      id: input.eventTypeId,
      userId: ctx.user.id,
    });
    if (!eventType) throw new TRPCError({ code: "FORBIDDEN" });
  }

  const userAvailabilityService = getUserAvailabilityService();
  // A username is unique only per organization, so the caller's own record is looked up by id
  const user = await getUser(isAdmin ? { username: input.username } : { id: ctx.user.id });
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  return userAvailabilityService.getUserAvailabilityIncludingBusyTimesFromLimits(
    { ...input, returnDateOverrides: true, bypassBusyCalendarTimes: false },
    {
      user,
    }
  );
};
