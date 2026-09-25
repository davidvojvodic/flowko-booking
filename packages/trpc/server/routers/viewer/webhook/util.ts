import { isActiveInstanceAdminSession } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { prisma } from "@calcom/prisma";

import { TRPCError } from "@trpc/server";
import type { z } from "zod";

import authedProcedure from "../../../procedures/authedProcedure";
import { webhookIdAndEventTypeIdSchema } from "./types";

async function ensureEventTypeOwner(eventTypeId: number, userId: number): Promise<void> {
  const eventType = await prisma.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true },
  });

  if (!eventType) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (eventType.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

/**
 * Flowko: the caller may act only on a webhook they own. Denies by default: a platform webhook (it receives
 * every tenant's booking events) belongs to the active instance admin, an event-type webhook to the event
 * type's owner, and any other webhook to its user. A row with no user and no event type (a team or app
 * webhook) therefore belongs to nobody. This holds on its own, so it stays safe if the admin-only rule above
 * it ever changes.
 */
export async function ensureWebhookAccess({
  userId,
  isInstanceAdmin,
  input,
}: {
  userId: number;
  isInstanceAdmin: boolean;
  input: z.infer<typeof webhookIdAndEventTypeIdSchema>;
}): Promise<void> {
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
        platform: true,
      },
    });

    if (!webhook) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    // Flowko: any given event type has to be the webhook's own, since the handlers filter and write by it
    if (eventTypeId !== undefined && eventTypeId !== webhook.eventTypeId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (webhook.platform) {
      // Flowko: a platform webhook has no user, so only an active instance admin may touch it
      if (!isInstanceAdmin) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    } else if (webhook.eventTypeId) {
      await ensureEventTypeOwner(webhook.eventTypeId, userId);
    } else if (webhook.userId !== userId) {
      // Flowko: deny by default, so a webhook without a user (userId null) is nobody's
      throw new TRPCError({ code: "FORBIDDEN" });
    }
  } else if (eventTypeId !== undefined) {
    await ensureEventTypeOwner(eventTypeId, userId);
  }
}

export const createWebhookProcedure = () => {
  return authedProcedure.input(webhookIdAndEventTypeIdSchema.optional()).use(async ({ ctx, input, next }) => {
    // Flowko: a webhook sends full booker data to any URL, and client businesses have no use for one, so
    // only an instance admin may list, read, create, edit, test or delete webhooks. An ADMIN without 2FA or a
    // strong password is an INACTIVE_ADMIN at sign-in, but the database still says ADMIN.
    const isInstanceAdmin = await isActiveInstanceAdminSession(ctx.user, ctx.req);
    if (!isInstanceAdmin) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    if (!input) return next();

    await ensureWebhookAccess({ userId: ctx.user.id, isInstanceAdmin, input });

    return next();
  });
};

export const webhookProcedure = createWebhookProcedure();
