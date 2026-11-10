// Flowko U29b (S13, S16): roster.week polls like the desk while the draft is clean and stops while it is dirty;
// the refresh after a roster write covers roster.week, the desk's bookings and free starts, and the settings only
// for a holiday change. Flowko U29c (P1): the refresh answers whether roster.week (the probe) was read again.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rosterWeek } from "./desk.fixture";
import { deskTrpc, resetDeskTrpc } from "./desk.testDoubles";
import { useInvalidateRoster, useRosterWeek } from "./useRosterData";

vi.mock("@calcom/trpc/react", async () => (await import("./desk.testDoubles")).trpcModule);

describe("useRosterWeek / useInvalidateRoster (U29b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDeskTrpc();
  });

  it("asks roster.week for the week, polling every 30 s and on focus while clean", () => {
    const view = rosterWeek();
    deskTrpc.rosterWeekQuery.mockReturnValue({ data: view, isPending: false, error: null, refetch: vi.fn() });
    const { result } = renderHook(() => useRosterWeek("2026-11-16", { enabled: true, paused: false }));
    expect(deskTrpc.rosterWeekQuery).toHaveBeenCalledWith(
      { weekStart: "2026-11-16" },
      { enabled: true, refetchInterval: 30000, refetchOnWindowFocus: true }
    );
    expect(result.current.view).toBe(view);
    expect(result.current.isPending).toBe(false);
  });

  it("paused (dirty draft): no interval and no focus refetch; disabled passes through", () => {
    renderHook(() => useRosterWeek("2026-11-23", { enabled: false, paused: true }));
    expect(deskTrpc.rosterWeekQuery).toHaveBeenCalledWith(
      { weekStart: "2026-11-23" },
      { enabled: false, refetchInterval: false, refetchOnWindowFocus: false }
    );
  });

  it("invalidate: roster.week + bookings day/week/free starts; settings only with { settings: true }", async () => {
    const { result } = renderHook(() => useInvalidateRoster());
    await act(() => result.current());
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledTimes(1);
    expect(deskTrpc.invalidateDay).toHaveBeenCalledTimes(1);
    expect(deskTrpc.invalidateWeek).toHaveBeenCalledTimes(1);
    expect(deskTrpc.invalidateFreeStarts).toHaveBeenCalledTimes(1);
    expect(deskTrpc.invalidateSettings).not.toHaveBeenCalled();
    await act(() => result.current({ settings: true }));
    expect(deskTrpc.invalidateSettings).toHaveBeenCalledTimes(1);
  });

  // Flowko U29c (P1): roster.week carries the versions, so it is the probe: invalidated with throwOnError, its answer
  // is the hook's answer; the desk's and the settings' refreshes only run alongside.
  it("probes roster.week with throwOnError and answers true when its refetch worked", async () => {
    const { result } = renderHook(() => useInvalidateRoster());
    let answer: boolean | undefined;
    await act(async () => {
      answer = await result.current();
    });
    expect(answer).toBe(true);
    expect(deskTrpc.invalidateRosterWeek).toHaveBeenCalledWith(undefined, undefined, { throwOnError: true });
  });

  it("answers false (never rejects) when the roster.week refetch failed", async () => {
    deskTrpc.invalidateRosterWeek.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useInvalidateRoster());
    let answer: boolean | undefined;
    await act(async () => {
      answer = await result.current({ settings: true });
    });
    expect(answer).toBe(false);
    expect(deskTrpc.invalidateDay).toHaveBeenCalledTimes(1);
    expect(deskTrpc.invalidateSettings).toHaveBeenCalledTimes(1);
  });

  it("a failed desk or settings refresh does not change the answer", async () => {
    deskTrpc.invalidateDay.mockRejectedValue(new Error("network"));
    deskTrpc.invalidateSettings.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useInvalidateRoster());
    let answer: boolean | undefined;
    await act(async () => {
      answer = await result.current({ settings: true });
    });
    expect(answer).toBe(true);
  });

  it("resolves when the roster.week probe has, not before", async () => {
    let release: () => void = () => undefined;
    deskTrpc.invalidateRosterWeek.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const { result } = renderHook(() => useInvalidateRoster());
    let done: boolean | undefined;
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current().then((ok) => {
        done = ok;
      });
    });
    await Promise.resolve();
    expect(done).toBeUndefined();
    release();
    await act(() => pending);
    expect(done).toBe(true);
  });
});
