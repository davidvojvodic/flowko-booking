import { v4 } from "uuid";

import { generateUniqueAPIKey } from "@calcom/features/api-keys-legacy/api-keys/lib/apiKeys";
import { ErrorCode } from "@calcom/lib/errorCodes";
import prisma from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../types";
import { checkPermissions } from "./_auth-middleware";
import type { TCreateInputSchema } from "./create.schema";

type CreateHandlerOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id">;
  };
  input: TCreateInputSchema;
};

export const createHandler = async ({ ctx, input }: CreateHandlerOptions) => {
  const [hashedApiKey, apiKey] = generateUniqueAPIKey();

  // Here we snap never expires before deleting it so it's not passed to prisma create call.
  const { neverExpires, teamId, ...rest } = input;
  const userId = ctx.user.id;

  /** Only admin or owner can create apiKeys of team (if teamId is passed) */
  await checkPermissions({ userId, teamId, role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] } });

  // Flowko: an app's key (Zapier's, Make's) signs in to that app's routes, so no key is made for an app the
  // admin switched off (App.enabled = false) or for an appId without an App row
  if (typeof rest.appId === "string") {
    const app = await prisma.app.findUnique({ where: { slug: rest.appId }, select: { enabled: true } });
    if (!app?.enabled) throw new TRPCError({ code: "FORBIDDEN", message: ErrorCode.AppNotAvailable });
  }

  await prisma.apiKey.create({
    data: {
      id: v4(),
      userId: ctx.user.id,
      teamId,
      ...rest,
      // And here we pass a null to expiresAt if never expires is true. otherwise just pass expiresAt from input
      expiresAt: neverExpires ? null : rest.expiresAt,
      hashedKey: hashedApiKey,
    },
  });

  const apiKeyPrefix = process.env.API_KEY_PREFIX ?? "cal_";

  const prefixedApiKey = `${apiKeyPrefix}${apiKey}`;

  return prefixedApiKey;
};
