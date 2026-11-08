// Flowko U27: true when the signed-in user is a non-owner member (WORKER or STAFF) of a business, who gets Cal's
// bookings list only. The screens Cal has for event types, availability and out of office are the owner's. This
// only tidies the client: false while the query loads, on error and for a user in no business; the server
// guards (the write routes and the page redirects) are the security.
import { trpc } from "@calcom/trpc/react";

export function useFlowkoHidesCalScreens(): boolean {
  const { data } = trpc.viewer.flowko.business.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  return data?.hidesCalScreens === true;
}
