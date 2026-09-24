import { ErrorWithCode } from "@calcom/lib/errors";
import { HttpError } from "@calcom/lib/http-error";
import { getHttpStatusCode } from "@calcom/lib/server/getServerErrorFromUnknown";

import { TRPCError } from "@trpc/server";

// Copied from `TRPC_ERROR_CODE_KEY` from `@trpc/server/unstable-core-do-not-import`
type TRPCErrorCode =
  | "PARSE_ERROR"
  | "BAD_REQUEST"
  | "INTERNAL_SERVER_ERROR"
  | "NOT_IMPLEMENTED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_SUPPORTED"
  | "TIMEOUT"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "UNPROCESSABLE_CONTENT"
  | "TOO_MANY_REQUESTS"
  | "CLIENT_CLOSED_REQUEST";

export function httpStatusToTrpcCode(status: number): TRPCErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_SUPPORTED";
    case 408:
      return "TIMEOUT";
    case 409:
      return "CONFLICT";
    case 412:
      return "PRECONDITION_FAILED";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 422:
      return "UNPROCESSABLE_CONTENT";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 499:
      return "CLIENT_CLOSED_REQUEST";
    case 501:
      return "NOT_IMPLEMENTED";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

/**
 * Converts only ErrorWithCode instances, and HttpErrors with a 4xx status tRPC has a code for, to TRPC
 * errors to limit impact.
 *
 * TODO: Consider converting any unknown error into TRPC error in the future.
 */
export function convertErrorWithCodeToTRPCError(cause: unknown) {
  if (cause instanceof ErrorWithCode) {
    const statusCode = getHttpStatusCode(cause);
    return new TRPCError({
      code: httpStatusToTrpcCode(statusCode),
      message: cause.message ?? "",
      cause: cause,
    });
  }

  // Flowko: checkRateLimitAndThrowError throws HttpError 429. Unconverted, a rate-limited procedure answered
  // INTERNAL_SERVER_ERROR, so every denial was reported as an exception and retried by the client, which
  // tripled the load and spent the caller's own budget. A 4xx HttpError keeps its status now; a 5xx, or a
  // status tRPC has no code for, stays INTERNAL_SERVER_ERROR (still reported).
  if (cause instanceof HttpError && cause.statusCode >= 400 && cause.statusCode < 500) {
    const code = httpStatusToTrpcCode(cause.statusCode);
    if (code !== "INTERNAL_SERVER_ERROR") {
      return new TRPCError({ code, message: cause.message ?? "", cause });
    }
  }

  return cause;
}
