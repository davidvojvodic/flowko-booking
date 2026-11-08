// Flowko U27: a non-owner business member's navigation has no Event types and no Availability entry, in the
// desktop and the mobile lists; the list follows the flag when it changes.
// Flowko U28 (R16): a business member gets the desk entry "flowko_desk_nav" first; while the business query is
// still loading the list shows neither the desk entry nor Event types / Availability.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNavigationItems } from "./Navigation";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));
const mockBusiness = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({
  useFlowkoBusiness: () => mockBusiness(),
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

const NONE = { status: "none", me: null };
const OWNER = { status: "member", me: { role: "OWNER", hidesCalScreens: false } };
const WORKER = { status: "member", me: { role: "WORKER", hidesCalScreens: true } };

describe("useNavigationItems (U27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBusiness.mockReturnValue(NONE);
  });

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
    mockBusiness.mockReturnValue(WORKER);
    const { result } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toEqual(["flowko_desk_nav", "bookings", "apps"]);
    expect(names(result.current.mobileNavigationBottomItems)).toEqual(["flowko_desk_nav", "bookings", "more"]);
    expect(names(result.current.mobileNavigationMoreItems)).toEqual(["apps"]);
  });

  it("re-computes when the flag changes", () => {
    mockHides.mockReturnValue(false);
    const { result, rerender } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toContain("availability");
    mockHides.mockReturnValue(true);
    mockBusiness.mockReturnValue(WORKER);
    rerender();
    expect(names(result.current.desktopNavigationItems)).not.toContain("availability");
    expect(names(result.current.desktopNavigationItems)).not.toContain("event_types_page_title");
  });
});

describe("useNavigationItems (U28)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the owner the desk entry first, then today's list", () => {
    mockHides.mockReturnValue(false);
    mockBusiness.mockReturnValue(OWNER);
    const { result } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toEqual([
      "flowko_desk_nav",
      "event_types_page_title",
      "bookings",
      "availability",
      "apps",
    ]);
    expect(names(result.current.mobileNavigationBottomItems)[0]).toBe("flowko_desk_nav");
  });

  it("points the desk entry at /koledar with the calendar-days icon", () => {
    mockHides.mockReturnValue(false);
    mockBusiness.mockReturnValue(OWNER);
    const { result } = renderHook(() => useNavigationItems());
    expect(result.current.desktopNavigationItems[0]).toMatchObject({
      name: "flowko_desk_nav",
      href: "/koledar",
      icon: "calendar-days",
    });
  });

  it("shows neither the desk entry nor Event types / Availability while the business query loads", () => {
    mockHides.mockReturnValue(false);
    mockBusiness.mockReturnValue({ status: "loading", me: null });
    const { result } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toEqual(["bookings", "apps"]);
    expect(names(result.current.mobileNavigationBottomItems)).toEqual(["bookings", "more"]);
  });

  it("keeps today's list for a user in no business (or on error): no desk entry", () => {
    mockHides.mockReturnValue(false);
    mockBusiness.mockReturnValue(NONE);
    const { result } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).toEqual([
      "event_types_page_title",
      "bookings",
      "availability",
      "apps",
    ]);
  });

  it("re-computes when the status arrives", () => {
    mockHides.mockReturnValue(false);
    mockBusiness.mockReturnValue({ status: "loading", me: null });
    const { result, rerender } = renderHook(() => useNavigationItems());
    expect(names(result.current.desktopNavigationItems)).not.toContain("flowko_desk_nav");
    mockBusiness.mockReturnValue(OWNER);
    rerender();
    expect(names(result.current.desktopNavigationItems)[0]).toBe("flowko_desk_nav");
  });
});
