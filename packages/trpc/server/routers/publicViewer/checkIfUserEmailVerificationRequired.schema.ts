import { z } from "zod";

// Flowko: no userSessionEmail here. It was read from the client, so a caller could claim any session email;
// the router now takes it from the session.
export type TUserEmailVerificationRequiredSchema = {
  email: string;
};

export const ZUserEmailVerificationRequiredSchema: z.ZodType<TUserEmailVerificationRequiredSchema> = z.object(
  {
    email: z.string(),
  }
);
