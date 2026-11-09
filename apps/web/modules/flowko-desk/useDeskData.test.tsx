// Flowko U28: the day query polls every 30 s and on window focus (R13); invalidate covers day and week.
// Flowko U28b (B3): and the free starts, so a sheet never offers a start a desk write just took.
// Flowko U29a (S7): business.me polls with the desk; proven on a real QueryClient (business.me's useQuery is a thin
// react-query wrapper here), so the shell's own observer (useFlowkoBusiness, 5 minutes, no focus) sees the new answer.
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFlowkoBusiness } from "@calcom/web/lib/flowko/useFlowkoBusiness";

import { useDeskBusinessMePoll, useDeskDay, useDeskMembers, useDeskWeek } from "./useDeskData";

const dayQuery = vi.fn();
const weekQuery = vi.fn();
const membersQuery = vi.fn();
const invalidateDay = vi.fn();
const invalidateWeek = vi.fn();
const invalidateFreeStarts = vi.fn();
const meFetch = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: {
        flowko: {
          bookings: {
            day: { invalidate: invalidateDay },
            week: { invalidate: invalidateWeek },
            freeStarts: { invalidate: invalidateFreeStarts },
          },
        },
      },
    }),
    viewer: {
      flowko: {
        bookings: {
          day: { useQuery: (...args: unknown[]) => dayQuery(...args) },
          week: { useQuery: (...args: unknown[]) => weekQuery(...args) },
        },
        business: {
          members: { useQuery: (...args: unknown[]) => membersQuery(...args) },
          me: {
            useQuery: (_input: undefined, options: Record<string, unknown>) =>
              useQuery({ queryKey: ["flowko", "business", "me"], queryFn: () => meFetch(), ...options }),
          },
        },
      },
    },
  },
}));

describe("useDeskData (U28 R13)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("polls the day every 30 s and on window focus", () => {
    const refetch = vi.fn();
    dayQuery.mockReturnValue({ data: undefined, refetch, dataUpdatedAt: 0 });
    const { result } = renderHook(() => useDeskDay("2026-11-16"));
    expect(dayQuery).toHaveBeenCalledWith(
      { date: "2026-11-16" },
      expect.objectContaining({ refetchInterval: 30000, refetchOnWindowFocus: true })
    );
    expect(result.current.refetch).toBe(refetch);
  });

  it("invalidate refreshes the day, the week and the free starts (B3)", async () => {
    dayQuery.mockReturnValue({ data: undefined, refetch: vi.fn(), dataUpdatedAt: 0 });
    const { result } = renderHook(() => useDeskDay("2026-11-16"));
    await result.current.invalidate();
    expect(invalidateDay).toHaveBeenCalled();
    expect(invalidateWeek).toHaveBeenCalled();
    expect(invalidateFreeStarts).toHaveBeenCalled();
  });

  it("the week's invalidate refreshes the free starts too (B3)", async () => {
    weekQuery.mockReturnValue({ data: undefined, refetch: vi.fn(), dataUpdatedAt: 0 });
    const { result } = renderHook(() => useDeskWeek("2026-11-16", 2));
    await result.current.invalidate();
    expect(invalidateFreeStarts).toHaveBeenCalled();
  });

  it("polls the week like the day and asks for the chosen worker's Monday-based week", () => {
    const refetch = vi.fn();
    weekQuery.mockReturnValue({ data: undefined, refetch, dataUpdatedAt: 0 });
    const { result } = renderHook(() => useDeskWeek("2026-11-16", 2));
    expect(weekQuery).toHaveBeenCalledWith(
      { weekStart: "2026-11-16", memberId: 2 },
      expect.objectContaining({ refetchInterval: 30000, refetchOnWindowFocus: true, enabled: true })
    );
    expect(result.current.refetch).toBe(refetch);
  });

  it("keeps the week query off without a worker or when disabled", () => {
    weekQuery.mockReturnValue({ data: undefined, refetch: vi.fn(), dataUpdatedAt: 0 });
    renderHook(() => useDeskWeek("2026-11-16", null));
    expect(weekQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
    renderHook(() => useDeskWeek("2026-11-16", 2, { enabled: false }));
    expect(weekQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it("keeps the day query off when the week is shown", () => {
    dayQuery.mockReturnValue({ data: undefined, refetch: vi.fn(), dataUpdatedAt: 0 });
    renderHook(() => useDeskDay("2026-11-16", { enabled: false }));
    expect(dayQuery).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });

  it("reads the active members", () => {
    membersQuery.mockReturnValue({ data: [] });
    renderHook(() => useDeskMembers());
    expect(membersQuery).toHaveBeenCalled();
  });
});

describe("useDeskBusinessMePoll (U29a S7)", () => {
  const me = (sharedDevice: boolean) => ({
    businessId: 9,
    businessName: "Salon",
    businessSlug: "salon",
    memberId: 1,
    role: "OWNER",
    hidesCalScreens: false,
    sharedDevice,
  });
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  /** Advances the fake clock and lets react-query's notifications (setTimeout) and React's render run. */
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
      await vi.advanceTimersByTimeAsync(50);
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // another device turns the switch off after the first answer
    meFetch.mockResolvedValueOnce(me(true)).mockResolvedValue(me(false));
  });
  afterEach(() => {
    client.clear();
    vi.useRealTimers();
  });

  it("refetches business.me every 30 s, and the desk's useFlowkoBusiness sees the switch turned off", async () => {
    const { result } = renderHook(
      () => {
        useDeskBusinessMePoll();
        return useFlowkoBusiness();
      },
      { wrapper }
    );
    await advance(0);
    expect(result.current.me?.sharedDevice).toBe(true);
    expect(meFetch).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(meFetch).toHaveBeenCalledTimes(2);
    expect(result.current.me?.sharedDevice).toBe(false);
  });

  it("without it (the shell's 5-minute, no-focus options) the answer stays stale for the 30 s", async () => {
    const { result } = renderHook(() => useFlowkoBusiness(), { wrapper });
    await advance(0);
    await advance(30_000);
    expect(meFetch).toHaveBeenCalledTimes(1);
    expect(result.current.me?.sharedDevice).toBe(true);
  });
});
