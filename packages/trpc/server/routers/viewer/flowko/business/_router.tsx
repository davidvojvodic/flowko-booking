// Flowko U27: viewer.flowko.business.* (pattern: U26 roster router, lazy handler import).
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";

const load = () => import("./business.handler");

export const businessRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    return (await load()).meHandler({ ctx });
  }),
});
