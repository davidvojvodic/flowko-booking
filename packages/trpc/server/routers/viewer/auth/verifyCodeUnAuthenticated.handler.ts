import { verifyCodeUnAuthenticated } from "@calcom/features/auth/lib/verifyCodeUnAuthenticated";
import { HttpError } from "@calcom/lib/http-error";
import type { ZVerifyCodeInputSchema } from "@calcom/prisma/zod-utils";
import type { NextApiRequest } from "next";

import { TRPCError } from "@trpc/server";

import type { TRPCContext } from "../../../createContext";

type VerifyTokenOptions = {
  input: ZVerifyCodeInputSchema;
  req: TRPCContext["req"] | undefined;
};

export const verifyCodeUnAuthenticatedHandler = async ({ input, req }: VerifyTokenOptions) => {
  const { email, code } = input;
  try {
    // Flowko: pass the request so the per-IP limit runs; this public procedure is the only caller without an
    // IP limit of its own
    return await verifyCodeUnAuthenticated(email, code, req as NextApiRequest | undefined);
  } catch (error) {
    // Flowko: a rate-limit refusal stays a 429 (TOO_MANY_REQUESTS after the error conversion), not "invalid code"
    if (error instanceof HttpError && error.statusCode === 429) throw error;
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_code" });
  }
};
