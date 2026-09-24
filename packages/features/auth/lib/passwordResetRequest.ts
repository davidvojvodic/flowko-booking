import { randomBytes } from "node:crypto";

import dayjs from "@calcom/dayjs";
import { getTranslation } from "@calcom/i18n/server";
import prisma from "@calcom/prisma";
import type { User } from "@calcom/prisma/client";

export const PASSWORD_RESET_EXPIRY_HOURS = 6;

// Flowko: the request id is the whole reset link (/auth/forgot-password/<id>), a bearer secret that sets a new
// password on the account. Prisma's @default(cuid()) makes it from the time, a counter, a per-host fingerprint
// and two Math.random() draws (not a CSPRNG), so give it 256 random bits from the crypto RNG instead.
export const generatePasswordResetRequestId = () => randomBytes(32).toString("hex");

const RECENT_MAX_ATTEMPTS = 3;
const RECENT_PERIOD_IN_MINUTES = 5;

const createPasswordReset = async (email: string): Promise<string> => {
  const expiry = dayjs().add(PASSWORD_RESET_EXPIRY_HOURS, "hours").toDate();

  await prisma.resetPasswordRequest.updateMany({
    where: {
      email,
      expires: {
        gt: new Date(),
      },
    },
    data: {
      expires: new Date(),
    },
  });

  const createdResetPasswordRequest = await prisma.resetPasswordRequest.create({
    data: {
      id: generatePasswordResetRequestId(),
      email,
      expires: expiry,
    },
  });

  return `${process.env.NEXT_PUBLIC_WEBAPP_URL}/auth/forgot-password/${createdResetPasswordRequest.id}`;
};

const guardAgainstTooManyPasswordResets = async (email: string) => {
  const recentPasswordRequestsCount = await prisma.resetPasswordRequest.count({
    where: {
      email,
      createdAt: {
        gt: dayjs().subtract(RECENT_PERIOD_IN_MINUTES, "minutes").toDate(),
      },
    },
  });
  if (recentPasswordRequestsCount >= RECENT_MAX_ATTEMPTS) {
    throw new Error("Too many password reset attempts. Please try again later.");
  }
};
const passwordResetRequest = async (user: Pick<User, "email" | "name" | "locale">) => {
  const { email } = user;
  const t = await getTranslation(user.locale ?? "en", "common");
  await guardAgainstTooManyPasswordResets(email);
  const resetLink = await createPasswordReset(email);
  const { sendPasswordResetEmail } = await import("@calcom/emails/auth-email-service");

  // send email in user language
  await sendPasswordResetEmail({
    language: t,
    user,
    resetLink,
  });
};

export { passwordResetRequest };
