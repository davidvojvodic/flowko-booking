import { isActiveInstanceAdminSession } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { getWebhookFeature } from "@calcom/features/di/webhooks/containers/webhook";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import { TRPCError } from "@trpc/server";
import type { GetTokenParams } from "next-auth/jwt";
import type { TGetInputSchema } from "./get.schema";

type GetOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    req?: GetTokenParams["req"];
  };
  input: TGetInputSchema;
};

export const getHandler = async ({ ctx, input }: GetOptions) => {
  const webhookId = input.id || input.webhookId;
  // Flowko: the result carries the webhook's signing secret and subscriber URL. Under the procedure's
  // ownership check, read it only when the caller owns it (its user, or its event type's owner), or when it is
  // a platform webhook and the caller is an active instance admin. Without an id, a filter would match any row.
  if (!webhookId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  const ownedBy: Prisma.WebhookWhereInput[] = [
    { platform: false, eventTypeId: null, userId: ctx.user.id },
    { platform: false, eventType: { userId: ctx.user.id } },
  ];
  if (await isActiveInstanceAdminSession(ctx.user, ctx.req)) {
    ownedBy.push({ platform: true });
  }
  const accessible = await prisma.webhook.findFirst({
    where: { id: webhookId, OR: ownedBy },
    select: { id: true },
  });
  if (!accessible) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const { repository: webhookRepository } = getWebhookFeature();
  return await webhookRepository.findByWebhookId(accessible.id);
};
