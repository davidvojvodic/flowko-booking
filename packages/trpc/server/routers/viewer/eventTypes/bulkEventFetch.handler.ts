import { getBulkUserEventTypes } from "@calcom/app-store/_utils/getBulkEventTypes";
// Flowko U27: the worker mirror stays out of the bulk event-type picker.
import { mirrorIdsOfUser } from "@calcom/features/flowkoBusiness/mirror";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";

type BulkEventFetchOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

export const bulkEventFetchHandler = async ({ ctx }: BulkEventFetchOptions) => {
  const result = await getBulkUserEventTypes(ctx.user.id);
  // Flowko U27: filtered here (getBulkUserEventTypes is shared); a user without a mirror gets the result unchanged.
  const { eventTypeIds } = await mirrorIdsOfUser(prisma, ctx.user.id);
  if (eventTypeIds.length === 0) return result;
  return {
    ...result,
    eventTypes: result.eventTypes.filter((eventType) => !eventTypeIds.includes(eventType.id)),
  };
};
