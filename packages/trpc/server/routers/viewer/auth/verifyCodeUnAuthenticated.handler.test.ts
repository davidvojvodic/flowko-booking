import { HttpError } from "@calcom/lib/http-error";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyCodeUnAuthenticated: vi.fn() }));

vi.mock("@calcom/features/auth/lib/verifyCodeUnAuthenticated", () => ({
  verifyCodeUnAuthenticated: mocks.verifyCodeUnAuthenticated,
}));

import { verifyCodeUnAuthenticatedHandler } from "./verifyCodeUnAuthenticated.handler";

const input = { email: "booker@example.com", code: "123456" };
const req = { headers: { "x-forwarded-for": "203.0.113.7" } } as never;

describe("viewer.auth.verifyCodeUnAuthenticated handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the caller's request, so the per-IP limit runs", async () => {
    mocks.verifyCodeUnAuthenticated.mockResolvedValue(true);
    await expect(verifyCodeUnAuthenticatedHandler({ input, req })).resolves.toBe(true);
    expect(mocks.verifyCodeUnAuthenticated).toHaveBeenCalledWith(input.email, input.code, req);
  });

  it("keeps a rate-limit refusal a 429 instead of calling it an invalid code", async () => {
    const limited = new HttpError({ statusCode: 429, message: "Rate limit exceeded. Try again in 60 seconds." });
    mocks.verifyCodeUnAuthenticated.mockRejectedValue(limited);
    await expect(verifyCodeUnAuthenticatedHandler({ input, req })).rejects.toBe(limited);
  });

  it("still answers invalid_code for a wrong code", async () => {
    mocks.verifyCodeUnAuthenticated.mockRejectedValue(new Error("Invalid code"));
    const error = await verifyCodeUnAuthenticatedHandler({ input, req }).catch((e) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "BAD_REQUEST", message: "invalid_code" });
  });
});
