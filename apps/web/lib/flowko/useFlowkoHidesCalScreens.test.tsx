// Flowko U27: the client hook only reads hidesCalScreens === true from viewer.flowko.business.me.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFlowkoHidesCalScreens } from "./useFlowkoHidesCalScreens";

const mockUseQuery = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: { viewer: { flowko: { business: { me: { useQuery: (...args: unknown[]) => mockUseQuery(...args) } } } } },
}));

describe("useFlowkoHidesCalScreens (U27)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is true for a non-owner member", () => {
    mockUseQuery.mockReturnValue({ data: { role: "WORKER", hidesCalScreens: true } });
    expect(renderHook(() => useFlowkoHidesCalScreens()).result.current).toBe(true);
  });

  it("is false for the owner", () => {
    mockUseQuery.mockReturnValue({ data: { role: "OWNER", hidesCalScreens: false } });
    expect(renderHook(() => useFlowkoHidesCalScreens()).result.current).toBe(false);
  });

  it("is false for a user in no business", () => {
    mockUseQuery.mockReturnValue({ data: null });
    expect(renderHook(() => useFlowkoHidesCalScreens()).result.current).toBe(false);
  });

  it("is false while loading and on error", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isPending: true });
    expect(renderHook(() => useFlowkoHidesCalScreens()).result.current).toBe(false);
    mockUseQuery.mockReturnValue({ data: undefined, error: new Error("x") });
    expect(renderHook(() => useFlowkoHidesCalScreens()).result.current).toBe(false);
  });
});
