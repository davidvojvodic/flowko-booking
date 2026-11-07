// Flowko U26: maps the business services' FlowkoBusinessError onto tRPC. `forbidden` is FORBIDDEN (a missing id and
// another business's id look the same, by design); every other code is BAD_REQUEST whose message IS the code, so the
// client maps it to a text. Anything that is not a FlowkoBusinessError is rethrown untouched.
import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";
import { TRPCError } from "@trpc/server";

export function flowkoTrpcError(e: unknown): never {
  if (e instanceof FlowkoBusinessError) {
    throw new TRPCError({ code: e.code === "forbidden" ? "FORBIDDEN" : "BAD_REQUEST", message: e.code });
  }
  throw e;
}
