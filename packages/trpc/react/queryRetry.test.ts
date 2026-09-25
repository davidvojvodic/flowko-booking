import { describe, expect, it, vi } from "vitest";

import { TRPCClientError } from "@trpc/client";

import { shouldRetryQuery } from "./queryRetry";

// Capture the options trpc.ts hands createTRPCNext, so the test can read the query client config it builds
vi.mock("@trpc/next", () => ({ createTRPCNext: vi.fn((opts: unknown) => opts) }));

function clientError(code: string, httpStatus: number) {
  return TRPCClientError.from({
    error: { message: code, code: -32000, data: { code, httpStatus } },
  });
}

describe("shouldRetryQuery", () => {
  it("does not retry a rate-limited query", () => {
    expect(shouldRetryQuery(0, clientError("TOO_MANY_REQUESTS", 429))).toBe(false);
    expect(shouldRetryQuery(1, clientError("TOO_MANY_REQUESTS", 429))).toBe(false);
  });

  it.each([
    ["BAD_REQUEST", 400],
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
  ])("still does not retry %s", (code, httpStatus) => {
    expect(shouldRetryQuery(0, clientError(code, httpStatus))).toBe(false);
  });

  it("retries a server error up to three times", () => {
    const error = clientError("INTERNAL_SERVER_ERROR", 500);

    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(2, error)).toBe(true);
    expect(shouldRetryQuery(3, error)).toBe(false);
  });

  it("retries an error that carries no tRPC data, such as a network failure", () => {
    expect(shouldRetryQuery(0, TRPCClientError.from(new TypeError("Failed to fetch")))).toBe(true);
    expect(shouldRetryQuery(0, new Error("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(0, null)).toBe(true);
    expect(shouldRetryQuery(3, undefined)).toBe(false);
  });
});

describe("trpc query client config", () => {
  it("does not retry a rate-limited query", async () => {
    const { trpc } = await import("./trpc");
    const { config } = trpc as unknown as {
      config: (info: { ctx?: unknown }) => {
        queryClientConfig: {
          defaultOptions: { queries: { retry: (failureCount: number, error: unknown) => boolean } };
        };
      };
    };
    const { retry } = config({}).queryClientConfig.defaultOptions.queries;

    expect(retry(0, clientError("TOO_MANY_REQUESTS", 429))).toBe(false);
    expect(retry(0, clientError("INTERNAL_SERVER_ERROR", 500))).toBe(true);
  });
});
