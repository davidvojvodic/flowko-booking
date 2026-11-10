// Flowko U29b (S1, S13, S16): Urnik's read and its refresh. roster.week polls every 30 s and on window focus like
// the desk, but not while the draft is dirty (`paused`: the view then shows snapshot + draft, and a poll never
// rebases the edits; the save sends the snapshot's versions, D8). `useInvalidateRoster` refreshes roster.week and
// the desk's bookings/free starts after a saved week, usual week, absence or holiday change, and business.settings
// for a holiday change (`{ settings: true }`). Type-only import from features (server code, node:crypto).
// Flowko U29c (P1): the refresh is checked: roster.week (it carries the versions) is the probe and its answer is the
// hook's answer (true = read again); the desk's and the settings' refreshes only run alongside. It never rejects.
import { useCallback } from "react";

import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";
import { trpc } from "@calcom/trpc/react";
import { refreshAfterSave } from "@calcom/web/lib/flowko/refreshAfterSave";

import { DESK_POLL_MS, useInvalidateDesk } from "./useDeskData";

export function useRosterWeek(
  weekStart: string,
  opts: { enabled: boolean; paused: boolean }
): {
  view?: RosterWeekView;
  isPending: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  /** Flowko U29c (R11): when the answer arrived (dataUpdatedAt); a successful read moves it, a failed one never. */
  receivedAt: number;
} {
  const query = trpc.viewer.flowko.roster.week.useQuery(
    { weekStart },
    {
      enabled: opts.enabled,
      refetchInterval: opts.paused ? false : DESK_POLL_MS,
      refetchOnWindowFocus: !opts.paused,
    }
  );
  // Flowko U29b: an annotation, not a cast: the inferred route output must stay assignable to RosterWeekView.
  const view: RosterWeekView | undefined = query.data;
  return {
    view,
    isPending: query.isPending,
    error: query.error,
    refetch: query.refetch,
    receivedAt: query.dataUpdatedAt,
  };
}

// Flowko U29c (P1): answers false when roster.week could not be read again (after its retries); the caller then
// shows the refresh-failed notice. A saved write is never undone by that.
export function useInvalidateRoster(): (opts?: { settings?: boolean }) => Promise<boolean> {
  const utils = trpc.useUtils();
  const invalidateDesk = useInvalidateDesk();
  return useCallback(
    (opts?: { settings?: boolean }) =>
      refreshAfterSave(
        () => utils.viewer.flowko.roster.week.invalidate(undefined, undefined, { throwOnError: true }),
        [
          invalidateDesk,
          ...(opts?.settings ? [() => utils.viewer.flowko.business.settings.invalidate()] : []),
        ]
      ),
    [utils, invalidateDesk]
  );
}
