import { sendEmailVerificationByCode } from "@calcom/features/auth/lib/verifyEmail";
import { getEventTypeService } from "@calcom/features/eventtypes/di/EventTypeService.container";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { extractBaseEmail } from "@calcom/lib/extract-base-email";
import getIP from "@calcom/lib/getIP";
import { hashEmail, piiHasher } from "@calcom/lib/server/PiiHasher";
import { prisma } from "@calcom/prisma";
import type { NextApiRequest } from "next";
import type { TRPCContext } from "../../../createContext";
import { checkEmailVerificationRequired } from "../../publicViewer/checkIfUserEmailVerificationRequired.handler";
import type { TSendVerifyEmailCodeSchema } from "./sendVerifyEmailCode.schema";

/**
 * Flowko: codes one mailbox may be sent, from all IPs together. Postmark's free tier allows 100 mails a
 * month, and mail-bombing one address would hurt the sender's reputation.
 */
export const SEND_VERIFY_EMAIL_CODE_RECIPIENT_LIMIT = { limit: 5, duration: "10m" } as const;

// Flowko: the per-recipient key must name the mailbox, not the typed spelling. Case, a "+tag" and (for
// Gmail) dots in the local part all reach the same inbox, so each would otherwise get its own 5 mails.
const recipientMailbox = (email: string) => {
  const [localPart, domain] = extractBaseEmail(email.trim().toLowerCase()).split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${localPart.replace(/\./g, "")}@gmail.com`;
  }
  return `${localPart}@${domain}`;
};

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

  // Flowko: the limit above is keyed by the caller's IP only, so many IPs could flood one inbox. This caps
  // the codes one mailbox is sent. It runs only when a code would really be sent, so skipped requests
  // do not use up the recipient's allowance.
  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `sendVerifyEmailCode:to:${hashEmail(recipientMailbox(input.email))}`,
    opts: { limit: SEND_VERIFY_EMAIL_CODE_RECIPIENT_LIMIT },
  });

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
