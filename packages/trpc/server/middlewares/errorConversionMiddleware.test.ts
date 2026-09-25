import { captureException } from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { HttpError } from "@calcom/lib/http-error";

import { TRPCError } from "@trpc/server";

import { onErrorHandler } from "../onErrorHandler";
import authedProcedure from "../procedures/authedProcedure";
import publicProcedure from "../procedures/publicProcedure";
import { createCallerFactory, router } from "../trpc";

const mocks = vi.hoisted(() => ({ getUserSession: vi.fn(), getToken: vi.fn() }));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), setUser: vi.fn() }));

const CORE_LIMIT = 10;

const testRouter = router({
  rateLimitedQuery: publicProcedure.query(async () => {
    await checkRateLimitAndThrowError({ identifier: "errorConversion:public" });
    return "ok";
  }),
  rateLimitedMutation: authedProcedure.mutation(async ({ ctx }) => {
    await checkRateLimitAndThrowError({ identifier: `errorConversion:authed:${ctx.user.id}` });
    return "ok";
  }),
  throwsErrorWithCode: publicProcedure.query(() => {
    throw new ErrorWithCode(ErrorCode.Forbidden, "Not your booking");
  }),
  throwsHttpError: publicProcedure.input((v) => v as { statusCode: number }).query(({ input }) => {
    throw new HttpError({ statusCode: input.statusCode, message: `status ${input.statusCode}` });
  }),
  throwsTRPCError: publicProcedure.query(() => {
    throw new TRPCError({ code: "CONFLICT", message: "Slug taken" });
  }),
  throwsError: publicProcedure.query(() => {
    throw new Error("Something broke");
  }),
  throwsWrappedHttpError: publicProcedure.query(() => {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not reach the calendar",
      cause: new HttpError({ statusCode: 401, message: "Upstream token abc123 is invalid" }),
    });
  }),
});

const createCaller = createCallerFactory(testRouter);

function anonymousCaller() {
  mocks.getUserSession.mockResolvedValue(null);
  return createCaller({ req: {} } as Parameters<typeof createCaller>[0]);
}

function userCaller() {
  const sessionUser = { id: 7, username: "salon", identityProvider: "CAL", role: "USER" };
  mocks.getUserSession.mockResolvedValue({
    user: sessionUser,
    session: { user: { id: sessionUser.id }, upId: `usr-${sessionUser.id}` },
  });
  mocks.getToken.mockResolvedValue({ role: "USER" });
  return createCaller({ req: {} } as Parameters<typeof createCaller>[0]);
}

async function rejection(promise: Promise<unknown>): Promise<TRPCError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the call to be rejected");
    },
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(TRPCError);
  return error as TRPCError;
}

function resetSharedLimiter() {
  delete (globalThis as { flowkoInMemoryRateLimiter?: unknown }).flowkoInMemoryRateLimiter;
}

describe("errorConversionMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedLimiter();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSharedLimiter();
  });

  describe("with the production in-memory rate limiter", () => {
    beforeEach(() => {
      // Production: no UNKEY_ROOT_KEY, so rateLimiter() is the in-memory limiter
      vi.stubEnv("UNKEY_ROOT_KEY", "");
      vi.stubEnv("VITEST", "");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_IS_E2E", "");
    });

    it("answers TOO_MANY_REQUESTS with the limiter's message once a public procedure is rate limited", async () => {
      const caller = anonymousCaller();
      for (let i = 0; i < CORE_LIMIT; i++) {
        await expect(caller.rateLimitedQuery()).resolves.toBe("ok");
      }

      const error = await rejection(caller.rateLimitedQuery());

      expect(error.code).toBe("TOO_MANY_REQUESTS");
      expect(error.message).toMatch(/^Rate limit exceeded\. Try again in \d+ seconds\.$/);
      expect(error.cause).toBeInstanceOf(HttpError);
    });

    it("answers TOO_MANY_REQUESTS once an authed procedure is rate limited", async () => {
      const caller = userCaller();
      for (let i = 0; i < CORE_LIMIT; i++) {
        await expect(caller.rateLimitedMutation()).resolves.toBe("ok");
      }

      const error = await rejection(caller.rateLimitedMutation());

      expect(error.code).toBe("TOO_MANY_REQUESTS");
      expect(error.message).toMatch(/^Rate limit exceeded\./);
    });

    it("does not report a rate-limit denial to the exception capture", async () => {
      const caller = anonymousCaller();
      for (let i = 0; i < CORE_LIMIT; i++) await caller.rateLimitedQuery();
      const error = await rejection(caller.rateLimitedQuery());
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      onErrorHandler({ error });

      expect(captureException).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  it("converts an ErrorWithCode thrown by a handler to its tRPC code", async () => {
    const error = await rejection(anonymousCaller().throwsErrorWithCode());

    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toBe("Not your booking");
  });

  it.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [429, "TOO_MANY_REQUESTS"],
  ] as const)("converts an HttpError %i thrown by a handler to %s", async (statusCode, code) => {
    const error = await rejection(anonymousCaller().throwsHttpError({ statusCode }));

    expect(error.code).toBe(code);
    expect(error.message).toBe(`status ${statusCode}`);
  });

  it.each([402, 500, 502, 503])(
    "leaves an HttpError %i an INTERNAL_SERVER_ERROR, which is still reported",
    async (statusCode) => {
      const error = await rejection(anonymousCaller().throwsHttpError({ statusCode }));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      onErrorHandler({ error });

      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(captureException).toHaveBeenCalledWith(error);
      consoleSpy.mockRestore();
    }
  );

  it("keeps a TRPCError thrown by a handler as it is", async () => {
    const error = await rejection(anonymousCaller().throwsTRPCError());

    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("Slug taken");
  });

  it("keeps an explicit INTERNAL_SERVER_ERROR and its message, not its cause's", async () => {
    const error = await rejection(anonymousCaller().throwsWrappedHttpError());

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("Could not reach the calendar");
  });

  it("leaves any other error an INTERNAL_SERVER_ERROR", async () => {
    const error = await rejection(anonymousCaller().throwsError());

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("Something broke");
  });
});
