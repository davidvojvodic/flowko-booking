// Flowko U25: withFlowkoTx opens a transaction on a client and joins the caller's on a transaction client.
import { describe, expect, it, vi } from "vitest";
import { type FlowkoDb, withFlowkoTx } from "./db";

describe("withFlowkoTx", () => {
  it("opens one transaction on a client and hands fn the transaction client", async () => {
    const tx = { marker: "tx" };
    const $transaction = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const client = { $transaction } as unknown as FlowkoDb;
    const fn = vi.fn(async (t: unknown) => (t === tx ? "ran in tx" : "wrong client"));

    await expect(withFlowkoTx(client, fn)).resolves.toBe("ran in tx");
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(tx);
  });

  it("joins a caller's transaction: fn gets the transaction client itself", async () => {
    const tx = { marker: "caller tx" } as unknown as FlowkoDb;
    const fn = vi.fn(async (t: unknown) => (t === tx ? "joined" : "wrong client"));

    await expect(withFlowkoTx(tx, fn)).resolves.toBe("joined");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes a failure through", async () => {
    const tx = {} as unknown as FlowkoDb;
    await expect(withFlowkoTx(tx, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});
