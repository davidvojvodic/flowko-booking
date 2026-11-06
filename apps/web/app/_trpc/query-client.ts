"use client";

import { shouldRetryQuery } from "@calcom/trpc/react/queryRetry";
import { QueryClient } from "@tanstack/react-query";

let browserQueryClient: QueryClient | undefined;

// Flowko U20: one QueryClient per server request. The module-wide client was shared by every
// request's server render, and react-query keeps server cache entries forever, so one account's
// data could reach another account's HTML (6 Nov 2026 on prod: flowko-test's connected Google
// calendar in another account's /apps/installed/calendar). The browser keeps one client.
export const makeQueryClient = (): QueryClient =>
  new QueryClient({
    // these configurations are copied from "packages/trpc/react/trpc.ts"
    defaultOptions: {
      queries: {
        /**
         * 1s should be enough to just keep identical query waterfalls low
         * @example if one page components uses a query that is also used further down the tree
         */
        staleTime: 1000,
        /**
         * Retry `useQuery()` calls depending on this function
         */
        // Flowko U21: the same rule as the pages router (packages/trpc/react/trpc.ts). Upstream's copy here
        // retried TOO_MANY_REQUESTS 3 times, which only tripled the load on a rate limit.
        retry: shouldRetryQuery,
      },
    },
  });

export const getQueryClient = (isServer: boolean = typeof window === "undefined"): QueryClient => {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
};
