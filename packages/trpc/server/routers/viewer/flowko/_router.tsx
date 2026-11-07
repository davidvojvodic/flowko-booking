// Flowko U26: the `flowko` tRPC endpoint (viewer.flowko.*), home of Flowko's own procedures.
import { router } from "../../../trpc";
import { rosterRouter } from "./roster/_router";

export const flowkoRouter = router({
  roster: rosterRouter,
});
