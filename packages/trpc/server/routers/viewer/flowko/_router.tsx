// Flowko U26: the `flowko` tRPC endpoint (viewer.flowko.*), home of Flowko's own procedures.
import { router } from "../../../trpc";
import { bookingsRouter } from "./bookings/_router"; // Flowko U27
import { businessRouter } from "./business/_router"; // Flowko U27
import { rosterRouter } from "./roster/_router";
import { servicesRouter } from "./services/_router"; // Flowko U29a
import { workersRouter } from "./workers/_router"; // Flowko U29c

export const flowkoRouter = router({
  roster: rosterRouter,
  bookings: bookingsRouter, // Flowko U27
  business: businessRouter, // Flowko U27
  services: servicesRouter, // Flowko U29a
  workers: workersRouter, // Flowko U29c
});
