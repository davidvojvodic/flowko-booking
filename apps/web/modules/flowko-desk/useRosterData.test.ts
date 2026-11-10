// Flowko U29b (S13, S16): roster.week polls like the desk while the draft is clean and stops while it is dirty;
// the refresh after a roster write covers roster.week, the desk's bookings and free starts, and the settings only
// for a holiday change.
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

  it("invalidate resolves only when every refresh has", async () => {
    let release: () => void = () => undefined;
    deskTrpc.invalidateRosterWeek.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    const { result } = renderHook(() => useInvalidateRoster());
    let done = false;
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current().then(() => {
        done = true;
      });
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await act(() => pending);
    expect(done).toBe(true);
  });
});
