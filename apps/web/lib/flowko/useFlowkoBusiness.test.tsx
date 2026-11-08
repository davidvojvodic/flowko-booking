// Flowko U28: the tri-state hook over viewer.flowko.business.me, and the home link built on it.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFlowkoBusiness, useFlowkoHomeHref } from "./useFlowkoBusiness";

const mockUseQuery = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: { flowko: { business: { me: { useQuery: (...args: unknown[]) => mockUseQuery(...args) } } } },
  },
}));

const ME = { businessId: 1, memberId: 3, role: "WORKER", hidesCalScreens: true };

describe("useFlowkoBusiness (U28)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks with the same options as useFlowkoHidesCalScreens, so the cache is shared", () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    renderHook(() => useFlowkoBusiness());
    expect(mockUseQuery).toHaveBeenCalledWith(undefined, {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    });
  });

  it("is loading while there is no answer yet", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isPending: true });
    expect(renderHook(() => useFlowkoBusiness()).result.current).toEqual({ status: "loading", me: null });
  });

  it("is member with the row for a business member", () => {
    mockUseQuery.mockReturnValue({ data: ME });
    expect(renderHook(() => useFlowkoBusiness()).result.current).toEqual({ status: "member", me: ME });
  });

  it("is none for a user in no business and on error", () => {
    mockUseQuery.mockReturnValue({ data: null });
    expect(renderHook(() => useFlowkoBusiness()).result.current).toEqual({ status: "none", me: null });
    mockUseQuery.mockReturnValue({ data: undefined, error: new Error("x") });
    expect(renderHook(() => useFlowkoBusiness()).result.current).toEqual({ status: "none", me: null });
  });

  it("stays member when a background refetch fails (react-query keeps the data and sets the error)", () => {
    mockUseQuery.mockReturnValue({ data: ME, error: new Error("refetch failed") });
    expect(renderHook(() => useFlowkoBusiness()).result.current).toEqual({ status: "member", me: ME });
    mockUseQuery.mockReturnValue({ data: null, error: new Error("refetch failed") });
    expect(renderHook(() => useFlowkoBusiness()).result.current).toEqual({ status: "none", me: null });
  });
});

describe("useFlowkoHomeHref (U28)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is /koledar for a member and /event-types for everyone else, loading included", () => {
    mockUseQuery.mockReturnValue({ data: ME });
    expect(renderHook(() => useFlowkoHomeHref()).result.current).toBe("/koledar");
    mockUseQuery.mockReturnValue({ data: null });
    expect(renderHook(() => useFlowkoHomeHref()).result.current).toBe("/event-types");
    mockUseQuery.mockReturnValue({ data: undefined, isPending: true });
    expect(renderHook(() => useFlowkoHomeHref()).result.current).toBe("/event-types");
  });
});
