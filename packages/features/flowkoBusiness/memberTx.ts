// Flowko U29c: the transaction wrapper of the member writes (add desk-only, reorder; lock/unlock in lock.ts).
// A lock wait beyond Prisma's 5 s interactive-transaction limit (P2028), a write conflict or deadlock (P2034) and
// a deadlock on a raw lock statement (P2010 with 40P01) are one retryable answer, member_conflict, never a 500.
// The 40P01 matcher lives here once (roster.ts's rosterTx imports it); this file imports only ./db and ./errors.
import { Prisma } from "@calcom/prisma/client";
import { type FlowkoDb, withFlowkoTx } from "./db";
import { FlowkoBusinessError } from "./errors";

/**
 * A deadlock on a raw statement ($executeRaw) arrives as P2010: with the SQLSTATE in `meta.code` (classic form) or
 * in the pg driver-adapter form this client uses (`meta.driverAdapterError.cause` with `code`/`originalCode`).
 */
export function isRawDeadlock(e: Prisma.PrismaClientKnownRequestError): boolean {
  if (e.code !== "P2010") return false;
  const meta = (e.meta ?? {}) as {
    code?: unknown;
    driverAdapterError?: { cause?: { code?: unknown; originalCode?: unknown } };
  };
  const cause = meta.driverAdapterError?.cause;
  return meta.code === "40P01" || cause?.code === "40P01" || cause?.originalCode === "40P01";
}

/** Runs a member write in a transaction (joins the caller's when `db` is one); lock failures are member_conflict. */
export async function memberTx<T>(
  db: FlowkoDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  try {
    return await withFlowkoTx(db, fn);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === "P2028" || e.code === "P2034" || isRawDeadlock(e))
    )
      throw new FlowkoBusinessError("member_conflict");
    throw e;
  }
}
