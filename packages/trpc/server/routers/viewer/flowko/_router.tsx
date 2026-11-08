// Flowko U26: the `flowko` tRPC endpoint (viewer.flowko.*), home of Flowko's own procedures.
import { router } from "../../../trpc";
import { bookingsRouter } from "./bookings/_router"; // Flowko U27
import { businessRouter } from "./business/_router"; // Flowko U27
import { rosterRouter } from "./roster/_router";

export const flowkoRouter = router({
  roster: rosterRouter,
  bookings: bookingsRouter, // Flowko U27
  business: businessRouter, // Flowko U27
});
