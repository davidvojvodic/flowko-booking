import { TRPCError } from "@trpc/server";

import { convertErrorWithCodeToTRPCError } from "../lib/toTRPCError";
import { middleware } from "../trpc";

/**
 * Middleware that catches errors thrown by other layers and converts them to TRPCError.
 */
export const errorConversionMiddleware = middleware(async ({ next }) => {
  const result = await next();
  // Flowko: next() never throws. tRPC catches what a later middleware or the handler throws and hands it back
  // here as { ok: false, error: TRPCError INTERNAL_SERVER_ERROR (cause: the thrown error) }, so the old
  // try/catch converted nothing and a rate-limited call answered 500. Convert that wrapper's cause. Only a
  // wrapper tRPC made itself (message = the cause's) is converted: an explicit TRPCError keeps its code and
  // never gets its cause's message exposed.
  if (
    !result.ok &&
    result.error.code === "INTERNAL_SERVER_ERROR" &&
    result.error.cause &&
    result.error.message === result.error.cause.message
  ) {
    const converted = convertErrorWithCodeToTRPCError(result.error.cause);
    if (converted instanceof TRPCError) throw converted;
  }
  return result;
});
