// Flowko U26: serves viewer.flowko.* (the client sends `viewer.flowko.roster.week` to /api/trpc/flowko/roster.week).
import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { flowkoRouter } from "@calcom/trpc/server/routers/viewer/flowko/_router";

export default createNextApiHandler(flowkoRouter);
