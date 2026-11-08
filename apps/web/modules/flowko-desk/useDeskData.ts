// Flowko U28: the desk's reads. The day polls every 30 s and on window focus (R13: no push channel, two tablets
// are normal); `invalidate` refreshes every day and week view after a desk write, `refetch` the shown day (the
// write hooks refetch before a dialog or an error shows, R13).
// Flowko U28b (B3): `invalidate` covers the free starts too, so a booking sheet never offers a start a desk write
// just took.
import { useCallback } from "react";

import type { DeskView } from "@calcom/features/flowkoBusiness/desk";
import { trpc } from "@calcom/trpc/react";

export const DESK_POLL_MS = 30_000;

function useInvalidateDesk() {
  const utils = trpc.useUtils();
  return useCallback(
    () =>
      Promise.all([
        utils.viewer.flowko.bookings.day.invalidate(),
        utils.viewer.flowko.bookings.week.invalidate(),
        utils.viewer.flowko.bookings.freeStarts.invalidate(),
      ]),
    [utils]
  );
}

export function useDeskDay(date: string, options: { enabled?: boolean } = {}) {
  const query = trpc.viewer.flowko.bookings.day.useQuery(
    { date },
    { refetchInterval: DESK_POLL_MS, refetchOnWindowFocus: true, enabled: options.enabled ?? true }
  );
  const invalidate = useInvalidateDesk();
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

/**
 * Flowko U28 (D2): one worker x seven days; `weekStart` is the Monday of the business-zone week. Same polling as the
 * day (R13). `memberId` null (no worker chosen yet) keeps the query off.
 */
export function useDeskWeek(weekStart: string, memberId: number | null, options: { enabled?: boolean } = {}) {
  const query = trpc.viewer.flowko.bookings.week.useQuery(
    { weekStart, memberId: memberId ?? 0 },
    {
      refetchInterval: DESK_POLL_MS,
      refetchOnWindowFocus: true,
      enabled: (options.enabled ?? true) && memberId !== null,
    }
  );
  const invalidate = useInvalidateDesk();
  const view: DeskView | undefined = query.data;
  return {
    view,
    isPending: query.isPending,
    error: query.error,
    receivedAt: query.dataUpdatedAt,
    refetch: query.refetch,
    invalidate,
  };
}
