import { getSession } from "@calcom/features/auth/lib/userFromSessionUtils";

import publicProcedure from "../../procedures/publicProcedure";
import { router } from "../../trpc";
import { ZUserEmailVerificationRequiredSchema } from "./checkIfUserEmailVerificationRequired.schema";
import { ZMarkHostAsNoShowInputSchema } from "./markHostAsNoShow.schema";
import { event } from "./procedures/event";
import { ZSubmitRatingInputSchema } from "./submitRating.schema";

// things that unauthenticated users can query about themselves
export const publicViewerRouter = router({
  countryCode: publicProcedure.query(async (opts) => {
    const { default: handler } = await import("./countryCode.handler");
    return handler(opts);
  }),
  submitRating: publicProcedure.input(ZSubmitRatingInputSchema).mutation(async (opts) => {
    const { default: handler } = await import("./submitRating.handler");
    return handler(opts);
  }),
  markHostAsNoShow: publicProcedure.input(ZMarkHostAsNoShowInputSchema).mutation(async (opts) => {
    const { default: handler } = await import("./markHostAsNoShow.handler");
    return handler(opts);
  }),
  event,

  checkIfUserEmailVerificationRequired: publicProcedure
    .input(ZUserEmailVerificationRequiredSchema)
    .query(async (opts) => {
      // Flowko: the signed-in booker's own email comes from the session, never from the input, where a
      // caller could claim to be any user
      const session = await getSession(opts.ctx);
      const { default: handler } = await import("./checkIfUserEmailVerificationRequired.handler");
      return handler({ ctx: opts.ctx, input: opts.input, userSessionEmail: session?.user?.email ?? undefined });
    }),
});
