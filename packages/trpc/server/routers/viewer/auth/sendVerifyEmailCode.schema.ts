import { z } from "zod";

import { emailSchema } from "@calcom/lib/emailSchema";

export type TSendVerifyEmailCodeSchema = {
  email: string;
  username?: string;
  language: string;
  isVerifyingEmail?: boolean;
  eventTypeId?: number;
};

export const ZSendVerifyEmailCodeSchema: z.ZodType<TSendVerifyEmailCodeSchema> = z.object({
  email: emailSchema,
  username: z.string().optional(),
  language: z.string(),
  isVerifyingEmail: z.boolean().optional(),
  eventTypeId: z.number().optional(),
});
