import { isActiveInstanceAdmin } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { prisma } from "@calcom/prisma";

import { TRPCError } from "@trpc/server";

import authedProcedure from "../../../procedures/authedProcedure";
import { webhookIdAndEventTypeIdSchema } from "./types";

export const createWebhookProcedure = () => {
  return authedProcedure.input(webhookIdAndEventTypeIdSchema.optional()).use(async ({ ctx, input, next }) => {
    // Flowko: a webhook sends full booker data to any URL, and client businesses have no use for one, so
    // only an instance admin may list, read, create, edit, test or delete webhooks. An ADMIN without 2FA is
    // an INACTIVE_ADMIN at sign-in, but the database still says ADMIN, so the role alone is not enough.
    if (!isActiveInstanceAdmin(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    if (!input) return next();

    const { id, webhookId, eventTypeId } = input;
    const lookupId = id || webhookId;

    if (lookupId) {
      // Check if user is authorized to edit webhook
      const webhook = await prisma.webhook.findUnique({
        where: { id: lookupId },
        select: {
          id: true,
          userId: true,
          eventTypeId: true,
        },
      });

      if (!webhook) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (eventTypeId && eventTypeId !== webhook.eventTypeId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (webhook.eventTypeId) {
        const eventType = await prisma.eventType.findUnique({
          where: { id: webhook.eventTypeId },
          select: { id: true, userId: true },
        });

        if (!eventType) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        if (eventType.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      } else if (webhook.userId && webhook.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    } else if (eventTypeId) {
      const eventType = await prisma.eventType.findUnique({
        where: { id: eventTypeId },
        select: { id: true, userId: true },
      });

      if (!eventType) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (eventType.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    }

    return next();
  });
};

export const webhookProcedure = createWebhookProcedure();
