// Flowko U27: viewer.flowko.bookings.* (pattern: U26 roster router, lazy handler import). Rights live in the services.
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import {
  ZCancelBookingInput,
  ZCreateBookingInput,
  ZCustomersInput,
  ZDayInput,
  ZFreeStartsInput,
  ZMoveBookingInput,
  ZNoShowInput,
  ZWeekInput,
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
  // Flowko U28: the desk's reads (own rate-limit bucket) and its no-show write.
  day: authedProcedure.input(ZDayInput).query(async ({ ctx, input }) => {
    return (await load()).dayHandler({ ctx, input });
  }),
  week: authedProcedure.input(ZWeekInput).query(async ({ ctx, input }) => {
    return (await load()).weekHandler({ ctx, input });
  }),
  customers: authedProcedure.input(ZCustomersInput).query(async ({ ctx, input }) => {
    return (await load()).customersHandler({ ctx, input });
  }),
  noShow: authedProcedure.input(ZNoShowInput).mutation(async ({ ctx, input }) => {
    return (await load()).noShowHandler({ ctx, input });
  }),
});
