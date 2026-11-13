// Flowko U29c: memberTx maps the transaction failures a member write can meet (a lock wait past Prisma's 5 s
// interactive-transaction limit P2028, a write conflict or deadlock P2034, a deadlock on a raw lock statement
// P2010 with 40P01 in either meta form) to the retryable member_conflict; every other error passes through.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported; memberTx takes `db` and never imports it.
import "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { describe, expect, it } from "vitest";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { memberTx } from "./memberTx";

const db = prismock as unknown as FlowkoDb;
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, { code, clientVersion: "6", meta });

async function codeOf(error: unknown): Promise<string> {
  try {
    await memberTx(db, async () => {
      throw error;
    });
    return "ok";
  } catch (e) {
    if (e instanceof FlowkoBusinessError) return e.code;
    throw e;
  }
}

describe("memberTx (U29c)", () => {
  it("returns the callback's value", async () => {
    expect(await memberTx(db, async () => 42)).toBe(42);
  });

  it("maps P2028 (interactive transaction timed out) and P2034 (write conflict / deadlock) to member_conflict", async () => {
    expect(await codeOf(known("P2028"))).toBe("member_conflict");
    expect(await codeOf(known("P2034"))).toBe("member_conflict");
  });

  it("maps a raw-statement deadlock to member_conflict in the classic meta form", async () => {
    expect(await codeOf(known("P2010", { code: "40P01", message: "deadlock detected" }))).toBe(
      "member_conflict"
    );
  });

  it("maps a raw-statement deadlock to member_conflict in the pg driver-adapter meta form (code and originalCode)", async () => {
    const adapter = (cause: Record<string, unknown>) =>
      known("P2010", { driverAdapterError: { name: "DriverAdapterError", cause } });
    expect(await codeOf(adapter({ originalCode: "40P01", kind: "postgres", code: "40P01" }))).toBe(
      "member_conflict"
    );
    expect(await codeOf(adapter({ code: "40P01" }))).toBe("member_conflict");
    expect(await codeOf(adapter({ originalCode: "40P01" }))).toBe("member_conflict");
  });

  // U29d DATA-2: a deadlock whose victim is a non-raw Prisma statement reaches the caller as the bare pg
  // driver-adapter error (Prisma 6.16 `engineType = "client"` maps kind "postgres" to nothing and rethrows it).
  const driverAdapterError = (cause: Record<string, unknown>) =>
    Object.assign(new Error("driver adapter error"), { name: "DriverAdapterError", cause });

  it("maps a bare pg DriverAdapterError with 40P01 (code or originalCode) to member_conflict (U29d DATA-2)", async () => {
    expect(await codeOf(driverAdapterError({ kind: "postgres", code: "40P01", originalCode: "40P01" }))).toBe(
      "member_conflict"
    );
    expect(await codeOf(driverAdapterError({ kind: "postgres", code: "40P01" }))).toBe("member_conflict");
    expect(await codeOf(driverAdapterError({ kind: "postgres", originalCode: "40P01" }))).toBe(
      "member_conflict"
    );
  });

  it("rethrows a bare DriverAdapterError with any other SQLSTATE (23505) or no cause untouched (U29d DATA-2)", async () => {
    const unique = driverAdapterError({ kind: "postgres", code: "23505", originalCode: "23505" });
    await expect(memberTx(db, async () => Promise.reject(unique))).rejects.toBe(unique);
    const noCause = Object.assign(new Error("driver adapter error"), { name: "DriverAdapterError" });
    await expect(memberTx(db, async () => Promise.reject(noCause))).rejects.toBe(noCause);
    const otherName = Object.assign(new Error("x"), { cause: { code: "40P01" } });
    await expect(memberTx(db, async () => Promise.reject(otherName))).rejects.toBe(otherName);
  });

  it("rethrows any other P2010, any other Prisma code and any other error untouched", async () => {
    const other = known("P2010", { code: "22P02" });
    await expect(memberTx(db, async () => Promise.reject(other))).rejects.toBe(other);
    const adapterOther = known("P2010", { driverAdapterError: { cause: { code: "23505" } } });
    await expect(memberTx(db, async () => Promise.reject(adapterOther))).rejects.toBe(adapterOther);
    const bare = known("P2010");
    await expect(memberTx(db, async () => Promise.reject(bare))).rejects.toBe(bare);
    const unique = known("P2002");
    await expect(memberTx(db, async () => Promise.reject(unique))).rejects.toBe(unique);
    const plain = new Error("boom");
    await expect(memberTx(db, async () => Promise.reject(plain))).rejects.toBe(plain);
    const flowko = new FlowkoBusinessError("forbidden");
    await expect(memberTx(db, async () => Promise.reject(flowko))).rejects.toBe(flowko);
  });
});
