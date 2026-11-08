import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";

type ListOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

export const listHandler = async ({ ctx }: ListOptions) => {
  await checkRateLimitAndThrowError({
    identifier: `eventTypes:list:${ctx.user.id}`,
    rateLimitingType: "common",
  });
  return await prisma.eventType.findMany({
    where: {
      userId: ctx.user.id,
      team: null,
      flowkoWorkerMirror: { is: null }, // Flowko U28: the worker mirrors stay out of Cal's lists
    },
    select: {
      id: true,
      title: true,
      description: true,
      length: true,
      schedulingType: true,
      slug: true,
      hidden: true,
      metadata: true,
    },
  });
};
