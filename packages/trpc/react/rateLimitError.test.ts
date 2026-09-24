import { describe, expect, it } from "vitest";

import { HttpError } from "@calcom/lib/http-error";

import { TRPCClientError } from "@trpc/client";

import { isRateLimitError } from "./rateLimitError";

function clientError(code: string, httpStatus: number, message = code) {
  return TRPCClientError.from({
    error: { message, code: -32000, data: { code, httpStatus } },
  });
}

describe("isRateLimitError", () => {
  it("recognises a rate-limited tRPC call", () => {
    expect(
      isRateLimitError(clientError("TOO_MANY_REQUESTS", 429, "Rate limit exceeded. Try again in 42 seconds."))
    ).toBe(true);
    expect(isRateLimitError({ message: "x", data: { httpStatus: 429 } })).toBe(true);
  });

  it("recognises the limiter's HttpError", () => {
    const error = new HttpError({ statusCode: 429, message: "Rate limit exceeded. Try again in 5 seconds." });

    expect(isRateLimitError(error)).toBe(true);
  });

  it("recognises the limiter's message without a status (fetch-wrapper, fetch JSON body, next-auth)", () => {
    // fetch-wrapper's HttpError.fromRequest spreads a Response, so statusCode ends up undefined
    expect(isRateLimitError({ message: "Rate limit exceeded. Try again in 42 seconds." })).toBe(true);
    expect(isRateLimitError("Rate limit exceeded. Try again in 42 seconds.")).toBe(true);
  });

  it.each([
    ["a tRPC bad request", clientError("BAD_REQUEST", 400, "Failed to update no-show status")],
    ["an internal error", clientError("INTERNAL_SERVER_ERROR", 500)],
    ["an HttpError 403", new HttpError({ statusCode: 403, message: "Forbidden" })],
    ["another message", { message: "booking_time_out_of_bounds_error" }],
    ["a next-auth error code", "incorrect-email-password"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 429],
    ["an error with null data", { message: "x", data: null }],
  ])("does not treat %s as a rate limit", (_, error) => {
    expect(isRateLimitError(error)).toBe(false);
  });
});
