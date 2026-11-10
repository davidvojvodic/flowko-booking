// Flowko U29c: refreshAfterSave (P1). The probe is the query that carries the version: true when it refetched, false
// when it rejected; the other invalidations run alongside and their failure never changes the answer.
import { describe, expect, it, vi } from "vitest";
import { refreshAfterSave } from "./refreshAfterSave";

describe("refreshAfterSave", () => {
  it("a probe that resolves → true", async () => {
    await expect(refreshAfterSave(() => Promise.resolve(), [])).resolves.toBe(true);
  });

  it("a probe that rejects → false (never throws)", async () => {
    await expect(refreshAfterSave(() => Promise.reject(new Error("offline")), [])).resolves.toBe(false);
  });

  it("calls every other invalidation, and their rejection is ignored", async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const throwing = vi.fn(() => {
      throw new Error("sync boom");
    });
    await expect(refreshAfterSave(() => Promise.resolve(), [ok, failing, throwing])).resolves.toBe(true);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it("the others still run when the probe rejects", async () => {
    const other = vi.fn().mockResolvedValue(undefined);
    await expect(refreshAfterSave(() => Promise.reject(new Error("x")), [other])).resolves.toBe(false);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the others to answer", async () => {
    const never = vi.fn(() => new Promise<void>(() => undefined));
    await expect(refreshAfterSave(() => Promise.resolve(), [never])).resolves.toBe(true);
  });
});
