// Flowko U29b: the worker's transaction-scoped advisory lock (U27 W2), moved here from bookingWriter.ts unchanged
// so the roster savers (roster.ts) can take the booking writer's lock without an import cycle (bookingWriter.ts
// imports roster.ts). bookingWriter.ts re-exports it, so its callers are unchanged. Server only.
import type { Prisma } from "@calcom/prisma/client";

/** W2: the advisory-lock namespace of the booking writer; the second key is the worker's user id. */
const WORKER_LOCK_NAMESPACE = 27027;

/** W2: the worker's transaction-scoped advisory lock; two desks writing one worker's day queue here. */
export async function lockWorkerAdvisory(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  // $executeRaw, not $queryRaw: the function returns void, which the query path cannot deserialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WORKER_LOCK_NAMESPACE}::integer, ${userId}::integer)`;
}
