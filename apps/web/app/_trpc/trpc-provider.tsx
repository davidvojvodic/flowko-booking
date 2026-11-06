"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { getQueryClient } from "./query-client";
import { trpc } from "./trpc";
import { trpcClient } from "./trpc-client";

type Props = {
  children: React.ReactNode;
};

export const TrpcProvider = ({ children }: Props) => {
  // Flowko U20: a new client per server request, one client in the browser. No useState: a render
  // that suspends before mounting would otherwise drop the client (TanStack's app-router pattern).
  const queryClient = getQueryClient();
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
};
