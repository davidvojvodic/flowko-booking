// Flowko U27: a non-owner business member's navigation has no Event types and no Availability entry, in the
// desktop and the mobile lists; the list follows the flag when it changes.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNavigationItems } from "./Navigation";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));
vi.mock("@calcom/embed-core/embed-iframe", () => ({ useIsEmbed: () => false }));
vi.mock("@calcom/lib/hooks/useIsStandalone", () => ({ useIsStandalone: () => false }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated" }) }));
vi.mock("../../bookings/components/UnconfirmedBookingBadge", () => ({ default: () => null }));
vi.mock("../Kbar", () => ({ KBarTrigger: () => null }));
vi.mock("./NavigationItem", () => ({
  MobileNavigationItem: () => null,
  MobileNavigationMoreItem: () => null,
  NavigationItem: () => null,
}));
vi.mock("./useMobileMoreItems", () => ({ useMobileMoreItems: () => [] }));

const names = (items: { name: string }[]): string[] => items.map((item) => item.name);

describe("useNavigationItems (U27)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps every entry when the screens are not hidden", () => {
    mockHides.mockReturnValue(false);
    const { result } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toEqual([
      "event_types_page_title",
      "bookings",
      "availability",
      "apps",
    ]);
    expect(names(result.current.mobileNavigationBottomItems)).toContain("event_types_page_title");
    expect(names(result.current.mobileNavigationBottomItems)).toContain("availability");
  });

  it("drops Event types and Availability from the desktop and mobile lists when hidden", () => {
    mockHides.mockReturnValue(true);
    const { result } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toEqual(["bookings", "apps"]);
    expect(names(result.current.mobileNavigationBottomItems)).toEqual(["bookings", "more"]);
    expect(names(result.current.mobileNavigationMoreItems)).toEqual(["apps"]);
  });

  it("re-computes when the flag changes", () => {
    mockHides.mockReturnValue(false);
    const { result, rerender } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toContain("availability");
    mockHides.mockReturnValue(true);
    rerender();
    expect(names(result.current.desktopNavigationItems)).not.toContain("availability");
    expect(names(result.current.desktopNavigationItems)).not.toContain("event_types_page_title");
  });
});
