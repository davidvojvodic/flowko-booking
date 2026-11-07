// Flowko U27: viewer.flowko.bookings.* (pattern: U26 roster router, lazy handler import). Rights live in the services.
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import {
  ZCancelBookingInput,
  ZCreateBookingInput,
  ZFreeStartsInput,
  ZMoveBookingInput,
} from "./bookings.schema";

const load = () => import("./bookings.handler");

export const bookingsRouter = router({
  freeStarts: authedProcedure.input(ZFreeStartsInput).query(async ({ ctx, input }) => {
    return (await load()).freeStartsHandler({ ctx, input });
  }),
  create: authedProcedure.input(ZCreateBookingInput).mutation(async ({ ctx, input }) => {
    return (await load()).createHandler({ ctx, input });
  }),
  cancel: authedProcedure.input(ZCancelBookingInput).mutation(async ({ ctx, input }) => {
    return (await load()).cancelHandler({ ctx, input });
  }),
  move: authedProcedure.input(ZMoveBookingInput).mutation(async ({ ctx, input }) => {
    return (await load()).moveHandler({ ctx, input });
  }),
});
