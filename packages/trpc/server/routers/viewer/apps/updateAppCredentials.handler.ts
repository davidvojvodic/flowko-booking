import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../types";
import type { TUpdateAppCredentialsInputSchema } from "./updateAppCredentials.schema";

export type UpdateAppCredentialsOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TUpdateAppCredentialsInputSchema;
};

const validators = {
  paypal: () => import("@calcom/paypal/lib/updateAppCredentials.validator"),
};

// Flowko U9: only the payment apps whose Setup pages call this procedure (apps/web/components/apps/*/Setup.tsx)
// may have caller input merged into their stored key. Every other credential, Google Calendar above all, keeps
// its tokens encrypted in encryptedKey and must never have a raw key merged or rewritten here.
const APPS_WITH_EDITABLE_CREDENTIAL_KEYS = new Set(["paypal", "alby", "hitpay", "btcpayserver"]);

export const handleCustomValidations = async ({
  input,
  appId,
}: UpdateAppCredentialsOptions & { appId: string }) => {
  const { key } = input;
  const validatorGetter = validators[appId as keyof typeof validators];
  // If no validator is found, return the key as is
  if (!validatorGetter) return key;
  try {
    const validator = (await validatorGetter()).default;
    return await validator({ input });
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Validation failed",
    });
  }
};

export const updateAppCredentialsHandler = async ({ ctx, input }: UpdateAppCredentialsOptions) => {
  const { user } = ctx;

  // Find user credential
  const credential = await prisma.credential.findFirst({
    where: {
      id: input.credentialId,
      userId: user.id,
    },
    select: { id: true, appId: true, key: true, encryptedKey: true },
  });
  // Check if credential exists
  if (!credential) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Could not find credential ${input.credentialId}`,
    });
  }

  // Flowko U9: refuse before any validator (PayPal's calls PayPal) or write. A credential with an envelope
  // (encryptedKey not null, including "") holds only a placeholder in key, and merging into it would store caller
  // input next to the encrypted tokens.
  if (
    !APPS_WITH_EDITABLE_CREDENTIAL_KEYS.has(credential.appId ?? "") ||
    credential.encryptedKey !== null
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Credential ${credential.id} can't be updated here`,
    });
  }

  const validatedKeys = await handleCustomValidations({ ctx, input, appId: credential.appId || "" });

  const updated = await prisma.credential.update({
    where: {
      id: credential.id,
    },
    data: {
      key: {
        ...(credential.key as Prisma.JsonObject),
        ...(validatedKeys as Prisma.JsonObject),
      },
    },
  });

  return !!updated;
};
