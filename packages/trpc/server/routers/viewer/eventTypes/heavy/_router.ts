import { MembershipRole } from "@calcom/prisma/enums";

import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import { flowkoCalScreensGuard } from "../../flowko/calScreensGuard"; // Flowko U27
import { createEventPbacProcedure } from "../util";
import { ZCreateInputSchema } from "./create.schema";
import { ZDuplicateInputSchema } from "./duplicate.schema";
import { ZUpdateInputSchema } from "./update.schema";

export const eventTypesRouter = router({
  create: authedProcedure
    .use(flowkoCalScreensGuard) // Flowko U27: non-owner business members get FORBIDDEN
    .input(ZCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { createHandler } = await import("./create.handler");

      return createHandler({
        ctx,
        input,
      });
    }),
  duplicate: createEventPbacProcedure("eventType.create", [MembershipRole.ADMIN, MembershipRole.OWNER])
    .use(flowkoCalScreensGuard) // Flowko U27: non-owner business members get FORBIDDEN
    .input(ZDuplicateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { duplicateHandler } = await import("./duplicate.handler");

      return duplicateHandler({
        ctx,
        input,
      });
    }),
  update: createEventPbacProcedure("eventType.update", [MembershipRole.ADMIN, MembershipRole.OWNER])
    .use(flowkoCalScreensGuard) // Flowko U27: non-owner business members get FORBIDDEN
    .input(ZUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { updateHandler } = await import("./update.handler");

      return updateHandler({
        ctx,
        input,
      });
    }),
});
