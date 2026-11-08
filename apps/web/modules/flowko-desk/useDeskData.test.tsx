// Flowko U28: the day query polls every 30 s and on window focus (R13); invalidate covers day and week.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeskDay, useDeskMembers, useDeskWeek } from "./useDeskData";

const dayQuery = vi.fn();
const weekQuery = vi.fn();
const membersQuery = vi.fn();
const invalidateDay = vi.fn();
const invalidateWeek = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: {
        flowko: { bookings: { day: { invalidate: invalidateDay }, week: { invalidate: invalidateWeek } } },
      },
    }),
    viewer: {
      flowko: {
        bookings: {
          day: { useQuery: (...args: unknown[]) => dayQuery(...args) },
          week: { useQuery: (...args: unknown[]) => weekQuery(...args) },
        },
        business: { members: { useQuery: (...args: unknown[]) => membersQuery(...args) } },
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

  it("invalidate refreshes both the day and the week", async () => {
    dayQuery.mockReturnValue({ data: undefined, refetch: vi.fn(), dataUpdatedAt: 0 });
    const { result } = renderHook(() => useDeskDay("2026-11-16"));
    await result.current.invalidate();
    expect(invalidateDay).toHaveBeenCalled();
    expect(invalidateWeek).toHaveBeenCalled();
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
