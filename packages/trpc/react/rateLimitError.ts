// checkRateLimitAndThrowError (packages/lib) throws HttpError 429 with this English message
const RATE_LIMIT_MESSAGE_PREFIX = "Rate limit exceeded";

const hasRateLimitMessage = (message: unknown): boolean =>
  typeof message === "string" && message.startsWith(RATE_LIMIT_MESSAGE_PREFIX);

/**
 * Flowko: tells whether an error the client got is the rate limiter's refusal, so a view can show
 * t("rate_limit_exceeded") in the user's language instead of the server's English text. It takes a tRPC
 * client error (TOO_MANY_REQUESTS / 429), an HttpError (429), the JSON body of a fetch() answer, or a bare
 * message (next-auth's signIn() gives the thrown message as res.error). A fetch-wrapper HttpError loses the
 * status (HttpError.fromRequest spreads a Response, whose status is a getter), so the message counts too.
 */
export function isRateLimitError(error: unknown): boolean {
  if (typeof error === "string") return hasRateLimitMessage(error);
  if (!error || typeof error !== "object") return false;
  const { data, statusCode, message } = error as {
    data?: { code?: unknown; httpStatus?: unknown } | null;
    statusCode?: unknown;
    message?: unknown;
  };
  return (
    data?.code === "TOO_MANY_REQUESTS" ||
    data?.httpStatus === 429 ||
    statusCode === 429 ||
    hasRateLimitMessage(message)
  );
}
