import { sendEmailVerificationByCode } from "@calcom/features/auth/lib/verifyEmail";
import { getEventTypeService } from "@calcom/features/eventtypes/di/EventTypeService.container";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { hashEmail, piiHasher } from "@calcom/lib/server/PiiHasher";
import { prisma } from "@calcom/prisma";
import type { NextApiRequest } from "next";
import type { TRPCContext } from "../../../createContext";
import { checkEmailVerificationRequired } from "../../publicViewer/checkIfUserEmailVerificationRequired.handler";
import type { TSendVerifyEmailCodeSchema } from "./sendVerifyEmailCode.schema";

type SendVerifyEmailCode = {
  input: TSendVerifyEmailCodeSchema;
  req: TRPCContext["req"] | undefined;
};

export const sendVerifyEmailCodeHandler = async ({ input, req }: SendVerifyEmailCode) => {
  const identifier = req ? piiHasher.hash(getIP(req as NextApiRequest)) : hashEmail(input.email);
  return sendVerifyEmailCode({ input, identifier });
};

export const sendVerifyEmailCode = async ({
  input,
  identifier,
}: {
  input: TSendVerifyEmailCodeSchema;
  identifier: string;
}) => {
  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `sendVerifyEmailCode:${identifier}`,
  });

  // This endpoint is public, so only send a code when a booking asks for one: the event type requires
  // booker email verification, or the address belongs to a user who requires it. Otherwise anyone
  // could use it to send mail to any address.
  const eventType = input.eventTypeId
    ? await prisma.eventType.findUnique({
        where: { id: input.eventTypeId },
        select: { requiresBookerEmailVerification: true },
      })
    : null;
  const isVerificationRequired =
    !!eventType?.requiresBookerEmailVerification ||
    (await checkEmailVerificationRequired({ email: input.email }));
  if (!isVerificationRequired) {
    return { ok: true, skipped: true };
  }

  let hideBranding = false;
  if (input.eventTypeId) {
    const eventTypeService = getEventTypeService();
    hideBranding = await eventTypeService.shouldHideBrandingForEventType(input.eventTypeId);
  }

  return await sendEmailVerificationByCode({
    email: input.email,
    // The name becomes the display name in the To header, so it must not be able to add recipients
    username: input.username?.replace(/[<>,;:"()\r\n]/g, " "),
    language: input.language,
    isVerifyingEmail: input.isVerifyingEmail,
    hideBranding,
  });
};
