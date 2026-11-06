"use client";

import { QueryClient } from "@tanstack/react-query";

import { TRPCClientError } from "@trpc/client";

const MAX_QUERY_RETRIES = 3;

const isTRPCClientError = (cause: unknown): cause is TRPCClientError<any> => {
  return cause instanceof TRPCClientError;
};

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
        retry(failureCount, error) {
          if (isTRPCClientError(error) && error.data) {
            const { code } = error.data;
            if (code === "BAD_REQUEST" || code === "FORBIDDEN" || code === "UNAUTHORIZED") {
              // if input data is wrong or you're not authorized there's no point retrying a query
              return false;
            }
          }
          return failureCount < MAX_QUERY_RETRIES;
        },
      },
    },
  });

let browserQueryClient: QueryClient | undefined;

export const getQueryClient = (isServer: boolean = typeof window === "undefined"): QueryClient => {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
};
