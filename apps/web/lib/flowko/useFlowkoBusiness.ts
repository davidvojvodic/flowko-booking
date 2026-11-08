// Flowko U28: the tri-state view of viewer.flowko.business.me for the shell: "loading" until the answer arrives,
// "member" for a business member (me = the row), "none" for a user in no business and on error. Same query options
// as useFlowkoHidesCalScreens, so both share one cache entry. Only tidies the client; the server guards are the
// security.
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
  if (error) return { status: "none", me: null };
  if (data === undefined) return { status: "loading", me: null };
  if (data === null) return { status: "none", me: null };
  return { status: "member", me: data };
}

/** Where the logo and the settings back button go: the desk for a business member, Cal's first screen otherwise. */
export function useFlowkoHomeHref(): string {
  return useFlowkoBusiness().status === "member" ? "/koledar" : "/event-types";
}
