import { bulkUpdateEventsToDefaultLocation } from "@calcom/app-store/_utils/bulkUpdateEventsToDefaultLocation";
import { getAppFromSlug } from "@calcom/app-store/utils";
import { prisma } from "@calcom/prisma";
import { userMetadata } from "@calcom/prisma/zod-utils";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../types";
import type { TBulkUpdateToDefaultLocationInputSchema } from "./bulkUpdateToDefaultLocation.schema";
import { ensureAppsEnabled } from "./ensureAppsEnabled";

type BulkUpdateToDefaultLocationOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TBulkUpdateToDefaultLocationInputSchema;
};

export const bulkUpdateToDefaultLocationHandler = async ({
  ctx,
  input,
}: BulkUpdateToDefaultLocationOptions) => {
  const { eventTypeIds } = input;
  // Flowko: the event types may not get the location of a default conferencing app the admin switched off
  const defaultAppSlug = userMetadata.parse(ctx.user.metadata)?.defaultConferencingApp?.appSlug;
  const defaultLocationType = getAppFromSlug(defaultAppSlug)?.appData?.location?.type;
  if (defaultLocationType) {
    await ensureAppsEnabled(prisma, { locations: [{ type: defaultLocationType }] });
  }

  try {
    return bulkUpdateEventsToDefaultLocation({
      eventTypeIds,
      user: ctx.user,
      prisma,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
      });
    }
    throw error;
  }
};
