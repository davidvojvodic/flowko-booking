const MAX_QUERY_RETRIES = 3;

// If input data is wrong or you're not authorized there's no point retrying a query.
// Flowko: nor when rate limited. A retry of TOO_MANY_REQUESTS only tripled the load and spent the caller's own
// budget before the limiter's window reset.
const NO_RETRY_CODES: ReadonlySet<unknown> = new Set([
  "BAD_REQUEST",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "TOO_MANY_REQUESTS",
]);

/**
 * Retry `useQuery()` calls depending on this function
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const code = (error as { data?: { code?: unknown } | null } | null | undefined)?.data?.code;
  if (NO_RETRY_CODES.has(code)) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}
