// Flowko U25: the database handle every Flowko service takes, and the helper that makes a writing service
// compose with its caller's transaction (the set-up script's `--apply` runs as one transaction).
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

export type FlowkoDb = PrismaClient | Prisma.TransactionClient;

/**
 * Runs `fn` in a transaction: opens one when `db` is a client, joins the caller's when `db` is already a
 * transaction client (a transaction client has no `$transaction`).
 */
export function withFlowkoTx<T>(db: FlowkoDb, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(fn) : fn(db);
}
