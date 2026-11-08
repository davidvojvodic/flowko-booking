import getEventTypeById from "@calcom/features/eventtypes/lib/getEventTypeById";
import { mirrorOfEventType } from "@calcom/features/flowkoBusiness/mirror"; // Flowko U28
import type { PrismaClient } from "@calcom/prisma";
import { TRPCError } from "@trpc/server"; // Flowko U28

import type { TrpcSessionUser } from "../../../types";
import type { TGetInputSchema } from "./get.schema";

type GetOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TGetInputSchema;
};

export const getHandler = async ({ ctx, input }: GetOptions) => {
  // Flowko U28: a worker mirror is never read through Cal's event-type screens, for anyone (the owner included)
  if (await mirrorOfEventType(ctx.prisma, input.id)) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return getEventTypeById({
    currentOrganizationId: ctx.user.profile?.organizationId ?? null,
    eventTypeId: input.id,
    userId: ctx.user.id,
    prisma: ctx.prisma,
    isTrpcCall: true,
    isUserOrganizationAdmin: !!ctx.user?.organization?.isOrgAdmin,
    userLocale: ctx.user.locale,
  });
};
