import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../types";
import type { TDeleteInputSchema } from "./delete.schema";

type DeleteOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TDeleteInputSchema;
};

export const deleteHandler = async ({ ctx, input }: DeleteOptions) => {
  const { id } = input;

  // Flowko: authorize the id deleted here, not the key the procedure middleware checked (it reads
  // eventTypeId ?? id), so a request can't pass the check on its own event type and delete another tenant's
  const eventType = await prisma.eventType.findUnique({
    where: { id },
    select: {
      userId: true,
      teamId: true,
      users: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!eventType) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (eventType.teamId) {
    // Flowko: there are no teams on this instance and the PBAC service is a stub that allows everything,
    // so a team event type needs an accepted admin or owner membership of its team
    const membership = await prisma.membership.findFirst({
      where: {
        teamId: eventType.teamId,
        userId: ctx.user.id,
        accepted: true,
        role: { in: [MembershipRole.ADMIN, MembershipRole.OWNER] },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
  } else if (eventType.userId !== ctx.user.id && !eventType.users.some((user) => user.id === ctx.user.id)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  await prisma.eventTypeCustomInput.deleteMany({
    where: {
      eventTypeId: id,
    },
  });

  await prisma.eventType.delete({
    where: {
      id,
    },
  });

  return {
    id,
  };
};
