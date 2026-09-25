import setDefaultConferencingApp from "@calcom/app-store/_utils/setDefaultConferencingApp";
import { getAppFromSlug } from "@calcom/app-store/utils";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";
import { ensureAppsEnabled } from "../eventTypes/ensureAppsEnabled";
import type { TSetDefaultConferencingAppSchema } from "./setDefaultConferencingApp.schema";

type SetDefaultConferencingAppOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TSetDefaultConferencingAppSchema;
};

export const setDefaultConferencingAppHandler = async ({ ctx, input }: SetDefaultConferencingAppOptions) => {
  // Flowko: this also puts the app's location on all the user's event types, so a disabled app is refused
  const locationType = getAppFromSlug(input.slug)?.appData?.location?.type;
  if (locationType) {
    await ensureAppsEnabled(prisma, { locations: [{ type: locationType }] });
  }
  return await setDefaultConferencingApp(ctx.user.id, input.slug);
};
