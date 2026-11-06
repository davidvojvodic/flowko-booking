// @vitest-environment node
import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";

import { getQueryClient, makeQueryClient } from "./query-client";

// Flowko U20: one QueryClient per server request. A module-wide client let one account's
// cached data reach another account's server-rendered page (prod proof 2026-11-06).
describe("getQueryClient", () => {
  it("returns a new client for every server call", () => {
    expect(getQueryClient(true)).not.toBe(getQueryClient(true));
  });

  it("returns one shared client in the browser", () => {
    expect(getQueryClient(false)).toBe(getQueryClient(false));
  });
});

describe("makeQueryClient", () => {
  const queries = () => makeQueryClient().getDefaultOptions().queries ?? {};
  const retry = (failureCount: number, error: unknown) =>
    (queries().retry as (failureCount: number, error: unknown) => boolean)(failureCount, error);

  it("keeps the 1 s stale time", () => {
    expect(queries().staleTime).toBe(1000);
  });

  it("does not retry an UNAUTHORIZED tRPC error", () => {
    const error = new TRPCClientError("x", {
      result: { error: { data: { code: "UNAUTHORIZED" } } },
    } as ConstructorParameters<typeof TRPCClientError>[1]);
    expect(retry(0, error)).toBe(false);
  });

  it("retries other errors up to 3 times", () => {
    expect(retry(2, new Error("net"))).toBe(true);
    expect(retry(3, new Error("net"))).toBe(false);
  });
});
