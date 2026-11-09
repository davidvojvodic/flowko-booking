// Flowko U29a: viewer.flowko.services.* (S14), the owner's service catalogue (pattern: U26 roster router, lazy
// handler import). Rights live in the services (owner only).
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import { ZRemoveServiceInput, ZReorderServicesInput, ZSaveServiceInput } from "./services.schema";

const load = () => import("./services.handler");

export const servicesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return (await load()).listHandler({ ctx });
  }),
  save: authedProcedure.input(ZSaveServiceInput).mutation(async ({ ctx, input }) => {
    return (await load()).saveHandler({ ctx, input });
  }),
  remove: authedProcedure.input(ZRemoveServiceInput).mutation(async ({ ctx, input }) => {
    return (await load()).removeHandler({ ctx, input });
  }),
  reorder: authedProcedure.input(ZReorderServicesInput).mutation(async ({ ctx, input }) => {
    return (await load()).reorderHandler({ ctx, input });
  }),
});
