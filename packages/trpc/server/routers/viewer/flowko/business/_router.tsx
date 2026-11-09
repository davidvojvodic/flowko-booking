// Flowko U27: viewer.flowko.business.* (pattern: U26 roster router, lazy handler import).
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import { ZUpdateSettingsInput } from "./business.schema"; // Flowko U29a

const load = () => import("./business.handler");

export const businessRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    return (await load()).meHandler({ ctx });
  }),
  // Flowko U28: the desk's service list and member list (own rate-limit bucket).
  services: authedProcedure.query(async ({ ctx }) => {
    return (await load()).servicesHandler({ ctx });
  }),
  members: authedProcedure.query(async ({ ctx }) => {
    return (await load()).membersHandler({ ctx });
  }),
  // Flowko U29a (S2, S14): the owner's business settings (owner only, own rate-limit bucket).
  settings: authedProcedure.query(async ({ ctx }) => {
    return (await load()).settingsHandler({ ctx });
  }),
  updateSettings: authedProcedure.input(ZUpdateSettingsInput).mutation(async ({ ctx, input }) => {
    return (await load()).updateSettingsHandler({ ctx, input });
  }),
});
