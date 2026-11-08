// Flowko U28: the tri-state view of viewer.flowko.business.me for the shell: "loading" until the answer arrives,
// "member" for a business member (me = the row, kept while a background refetch fails), "none" for a user in no
// business and on an error without data. Same query options as useFlowkoHidesCalScreens, so both share one cache
// entry. Only tidies the client; the server guards are the security.
import { trpc } from "@calcom/trpc/react";

export type FlowkoBusinessState =
  | { status: "loading"; me: null }
  | { status: "none"; me: null }
  | { status: "member"; me: NonNullable<ReturnType<typeof useMe>["data"]> };

function useMe() {
  return trpc.viewer.flowko.business.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFlowkoBusiness(): FlowkoBusinessState {
  const { data, error } = useMe();
  // Flowko U28: data before error: after a failed background refetch react-query keeps the last data and sets the
  // error, and a member must stay a member (else the desk loses its actor and the nav its „Koledar“).
  if (data) return { status: "member", me: data };
  if (data === null) return { status: "none", me: null };
  if (error) return { status: "none", me: null };
  return { status: "loading", me: null };
}

/** Where the logo and the settings back button go: the desk for a business member, Cal's first screen otherwise. */
export function useFlowkoHomeHref(): string {
  return useFlowkoBusiness().status === "member" ? "/koledar" : "/event-types";
}
