import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import type { TSetUiLanguageInputSchema } from "./setUiLanguage.schema";

type SetUiLanguageOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TSetUiLanguageInputSchema;
};

/**
 * Flowko U14: the sidebar's SL / EN switch. It changes only this person's screens: `User.locale`, which drives their
 * booking pages and e-mails, stays put. The stored row is read here because `ctx.user.metadata` went through the schema,
 * which drops keys it doesn't know.
 */
export const setUiLanguageHandler = async ({ ctx, input }: SetUiLanguageOptions) => {
  const stored = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { metadata: true },
  });
  const metadata =
    typeof stored?.metadata === "object" && stored.metadata !== null && !Array.isArray(stored.metadata)
      ? stored.metadata
      : {};

  await prisma.user.update({
    where: { id: ctx.user.id },
    data: { metadata: { ...metadata, uiLanguage: input.language } satisfies Prisma.InputJsonObject },
    select: { id: true },
  });

  return { locale: input.language };
};
