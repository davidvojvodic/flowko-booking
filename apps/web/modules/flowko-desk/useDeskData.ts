// Flowko U28: the desk's reads. The day polls every 30 s and on window focus (R13: no push channel, two tablets
// are normal); `invalidate` refreshes every day and week view after a desk write, `refetch` the shown day (the
// write hooks refetch before a dialog or an error shows, R13).
import { useCallback } from "react";

import type { DeskView } from "@calcom/features/flowkoBusiness/desk";
import { trpc } from "@calcom/trpc/react";

export const DESK_POLL_MS = 30_000;

export function useDeskDay(date: string) {
  const utils = trpc.useUtils();
  const query = trpc.viewer.flowko.bookings.day.useQuery(
    { date },
    { refetchInterval: DESK_POLL_MS, refetchOnWindowFocus: true }
  );
  const invalidate = useCallback(
    () =>
      Promise.all([
        utils.viewer.flowko.bookings.day.invalidate(),
        utils.viewer.flowko.bookings.week.invalidate(),
      ]),
    [utils]
  );
  // Flowko U28: an annotation, not a cast: the inferred route output must stay assignable to DeskView.
  const view: DeskView | undefined = query.data;
  return {
    view,
    isPending: query.isPending,
    error: query.error,
    /** When the shown answer arrived (device clock); the now-line counts from here (R18). */
    receivedAt: query.dataUpdatedAt,
    refetch: query.refetch,
    invalidate,
  };
}

/** ACTIVE members of the business (staff and desk-only included): the „who are you“ list (R9). */
export function useDeskMembers() {
  return trpc.viewer.flowko.business.members.useQuery(undefined, { staleTime: 60_000 });
}
