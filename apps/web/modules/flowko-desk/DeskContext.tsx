// Flowko U28: what the desk's sheets and write hooks (Task 7) need from the day view: the shown answer, the
// „who are you“ state, refresh hooks, and the open booking/details targets set by taps on the grid.
import { createContext, useContext } from "react";

import type { DeskView } from "@calcom/features/flowkoBusiness/desk";

import type { DeskBookTarget } from "./WorkerColumn";
import type { DeskActorState } from "./useDeskActor";

export type DeskContextValue = {
  /** Business-local "YYYY-MM-DD" of the shown day. */
  date: string;
  view: DeskView | undefined;
  actor: DeskActorState;
  /** Refetch the shown day now (before a dialog or error shows, R13). */
  refetch: () => Promise<unknown>;
  /** Invalidate every day and week view (after a desk write, R13). */
  invalidate: () => Promise<unknown>;
  /** A tap on an empty spot: the booking sheet's worker + start (R10). Null when closed. */
  bookTarget: DeskBookTarget | null;
  setBookTarget: (target: DeskBookTarget | null) => void;
  /** A tap on a booking: the details sheet's booking id. Null when closed. */
  detailsBookingId: number | null;
  setDetailsBookingId: (bookingId: number | null) => void;
};

export const DeskContext = createContext<DeskContextValue | null>(null);

export function useDeskContext(): DeskContextValue {
  const value = useContext(DeskContext);
  if (!value) throw new Error("Flowko U28: useDeskContext outside the desk");
  return value;
}
