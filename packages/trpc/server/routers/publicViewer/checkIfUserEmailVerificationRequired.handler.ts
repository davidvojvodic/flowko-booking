import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { extractBaseEmail } from "@calcom/lib/extract-base-email";
import getIP from "@calcom/lib/getIP";
import logger from "@calcom/lib/logger";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { prisma } from "@calcom/prisma";
import type { NextApiRequest } from "next";

import type { TRPCContext } from "../../createContext";
import type { TUserEmailVerificationRequiredSchema } from "./checkIfUserEmailVerificationRequired.schema";

const log = logger.getSubLogger({ prefix: ["checkIfUserEmailVerificationRequired"] });

export const userWithEmailHandler = async ({
  ctx,
  input,
  userSessionEmail,
}: {
  ctx: { req?: TRPCContext["req"] };
  input: TUserEmailVerificationRequiredSchema;
  /** The signed-in caller's email, from the session. Never from the input. */
  userSessionEmail?: string;
}) => {
  // Flowko: anonymous, and its answer says whether an address is a tenant's email, so throttle it per IP.
  const ip = ctx.req ? getIP(ctx.req as NextApiRequest) : "unknown";
  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `checkIfUserEmailVerificationRequired:${piiHasher.hash(ip)}`,
  });

  return checkEmailVerificationRequired({ email: input.email, userSessionEmail });
};

export const checkEmailVerificationRequired = async ({
  userSessionEmail,
  email,
}: {
  userSessionEmail?: string;
  email: string;
}) => {
  const baseEmail = extractBaseEmail(email);

  const blacklistedGuestEmails = process.env.BLACKLISTED_GUEST_EMAILS
    ? process.env.BLACKLISTED_GUEST_EMAILS.split(",")
    : [];

  const blacklistedEmail = blacklistedGuestEmails.find(
    (guestEmail: string) => guestEmail.toLowerCase() === baseEmail.toLowerCase()
  );

  if (!!blacklistedEmail && blacklistedEmail !== userSessionEmail) {
    // Flowko: never log the address the booker typed
    log.warn("Booker email is blacklisted");
    return true;
  }

  const userRepo = new UserRepository(prisma);
  const users = await userRepo.findManyByEmailsWithEmailVerificationSettings({ emails: [baseEmail] });
  const user = users[0];

  if (user?.requiresBookerEmailVerification && baseEmail.toLowerCase() !== userSessionEmail?.toLowerCase()) {
    log.warn("Booker email belongs to a user who requires booker email verification");
    return true;
  }

  return false;
};

export default userWithEmailHandler;
