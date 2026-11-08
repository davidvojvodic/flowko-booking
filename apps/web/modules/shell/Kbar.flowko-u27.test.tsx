// Flowko U28 (R16 f): the per-event-type shortcuts (and their query) exist only for a user in no business or the
// business owner; a WORKER or STAFF member and a user whose membership is still loading get none.
// Flowko U27: the palette offers Cal's Event types and Availability shortcuts unless the user is a non-owner
// business member; the flag arrives after the first render, so a hidden member's shortcuts leave again.
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { useKBar } from "kbar";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { KBarContent, KBarRoot } from "./Kbar";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));

const mockBusiness = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({
  useFlowkoBusiness: () => mockBusiness(),
}));
const mockEventTypesQuery = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { id: 2, role: "USER" } } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));
vi.mock("@calcom/app-store/appStoreMetaData", () => ({ appStoreMetadata: {} }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      eventTypes: {
        getEventTypesFromGroup: { useInfiniteQuery: (...args: unknown[]) => mockEventTypesQuery(...args) },
      },
      bookings: { get: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

function RegisteredActionIds(): JSX.Element {
  const { actions } = useKBar((state) => ({ actions: state.actions }));
  return <div data-testid="action-ids">{Object.keys(actions).sort().join(",")}</div>;
}
const tree = (): JSX.Element => (
  <KBarRoot>
    <RegisteredActionIds />
    <KBarContent />
  </KBarRoot>
);
const ids = (): string[] => screen.getByTestId("action-ids").textContent?.split(",") ?? [];

describe("Kbar Cal-screen shortcuts (U27)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBusiness.mockReturnValue({ status: "none", me: null });
    mockEventTypesQuery.mockReturnValue({ data: undefined });
  });

  it("offers Event types and Availability to a user who is not hidden", async () => {
    mockHides.mockReturnValue(false);
    render(tree());
    await waitFor(() => expect(ids()).toContain("event-types"));
    expect(ids()).toContain("schedule");
    expect(ids()).toContain("upcoming-bookings");
  });

  it("leaves both out for a non-owner member and keeps the rest", async () => {
    mockHides.mockReturnValue(true);
    render(tree());
    await waitFor(() => expect(ids()).toContain("upcoming-bookings"));
    expect(ids()).not.toContain("event-types");
    expect(ids()).not.toContain("schedule");
    expect(ids()).toContain("profile");
  });

  it("removes them again once the flag turns true after the first render", async () => {
    mockHides.mockReturnValue(false);
    const { rerender } = render(tree());
    await waitFor(() => expect(ids()).toContain("schedule"));

    mockHides.mockReturnValue(true);
    rerender(tree());
    await waitFor(() => expect(ids()).not.toContain("schedule"));
    expect(ids()).not.toContain("event-types");
  });
});

// The event-type shortcuts register inside the palette's portal, so the palette is opened first. jsdom has no Web
// Animations API; kbar's animator calls element.animate, so a stub stands in for it.
beforeAll(() => {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () => ({ cancel: () => undefined, finish: () => undefined, onfinish: null }),
  });
});
function OpenPalette(): null {
  const { query } = useKBar();
  useEffect(() => {
    query.toggle();
  }, [query]);
  return null;
}
const openTree = (): JSX.Element => (
  <KBarRoot>
    <OpenPalette />
    <RegisteredActionIds />
    <KBarContent />
  </KBarRoot>
);
const CACHED_EVENT_TYPES = { pages: [{ eventTypes: [{ id: 7, title: "Cut" }] }] };

describe("Kbar per-event-type shortcuts (U28)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHides.mockReturnValue(false);
    mockEventTypesQuery.mockReturnValue({ data: CACHED_EVENT_TYPES });
  });

  const lastEnabled = (): unknown =>
    (mockEventTypesQuery.mock.calls.at(-1)?.[1] as { enabled?: boolean } | undefined)?.enabled;

  it("registers them and queries for a user in no business", async () => {
    mockBusiness.mockReturnValue({ status: "none", me: null });
    render(openTree());
    await waitFor(() => expect(ids()).toContain("event-type-7"));
    expect(lastEnabled()).toBe(true);
  });

  it("registers them and queries for the business owner", async () => {
    mockBusiness.mockReturnValue({ status: "member", me: { role: "OWNER", hidesCalScreens: false } });
    render(openTree());
    await waitFor(() => expect(ids()).toContain("event-type-7"));
    expect(lastEnabled()).toBe(true);
  });

  it.each(["WORKER", "STAFF"])("does neither for a %s member, even with cached data", async (role) => {
    mockHides.mockReturnValue(true);
    mockBusiness.mockReturnValue({ status: "member", me: { role, hidesCalScreens: true } });
    render(openTree());
    await waitFor(() => expect(mockEventTypesQuery).toHaveBeenCalled());
    expect(lastEnabled()).toBe(false);
    expect(ids().some((id) => id.startsWith("event-type-"))).toBe(false);
  });

  it("does neither while the membership is still loading", async () => {
    mockBusiness.mockReturnValue({ status: "loading", me: null });
    render(openTree());
    await waitFor(() => expect(mockEventTypesQuery).toHaveBeenCalled());
    expect(lastEnabled()).toBe(false);
    expect(ids().some((id) => id.startsWith("event-type-"))).toBe(false);
  });
});
