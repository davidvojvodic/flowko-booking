import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActionTree } from "kbar";
import { useKBar } from "kbar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KBarContent, KBarRoot } from "./Kbar";

const mockUseSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

vi.mock("@calcom/app-store/appStoreMetaData", () => ({ appStoreMetadata: {} }));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      eventTypes: { getEventTypesFromGroup: { useInfiniteQuery: () => ({ data: undefined }) } },
      bookings: { get: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

let registeredActions: ActionTree = {};
function RegisteredActionIds(): JSX.Element {
  const { actions } = useKBar((state) => ({ actions: state.actions }));
  registeredActions = actions;
  return <div data-testid="action-ids">{Object.keys(actions).sort().join(",")}</div>;
}

const kbarTree = (): JSX.Element => (
  <KBarRoot>
    <RegisteredActionIds />
    <KBarContent />
  </KBarRoot>
);
const renderKbar = (): ReturnType<typeof render> => render(kbarTree());

const registeredIds = (): string[] => screen.getByTestId("action-ids").textContent?.split(",") ?? [];

describe("Kbar webhooks action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredActions = {};
  });

  it("is not offered to a plain user", async () => {
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 2, role: "USER" } } });
    renderKbar();

    await waitFor(() => expect(registeredIds()).toContain("api-keys"));
    expect(registeredIds()).not.toContain("webhooks");
  });

  it("is not offered while the session is still loading", async () => {
    mockUseSession.mockReturnValue({ status: "loading", data: null });
    renderKbar();

    await waitFor(() => expect(registeredIds()).toContain("api-keys"));
    expect(registeredIds()).not.toContain("webhooks");
  });

  it("is offered to an instance admin and opens the webhooks settings", async () => {
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 1, role: "ADMIN" } } });
    renderKbar();

    await waitFor(() => expect(registeredIds()).toContain("webhooks"));
    expect(registeredIds()).toContain("api-keys");

    registeredActions.webhooks.command?.perform();
    expect(mockPush).toHaveBeenCalledWith("/settings/developer/webhooks");
  });

  it("is offered to an admin once the session has loaded", async () => {
    mockUseSession.mockReturnValue({ status: "loading", data: null });
    const { rerender } = renderKbar();
    await waitFor(() => expect(registeredIds()).toContain("api-keys"));
    expect(registeredIds()).not.toContain("webhooks");

    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 1, role: "ADMIN" } } });
    rerender(kbarTree());

    await waitFor(() => expect(registeredIds()).toContain("webhooks"));
  });
});

// Flowko: upstream linked a query without results to https://cal.com/help (and opened it on Enter)
describe("Kbar with no results", () => {
  let kbarQuery: ReturnType<typeof useKBar>["query"] | undefined;
  function CaptureQuery(): null {
    kbarQuery = useKBar().query;
    return null;
  }

  // jsdom has no Web Animations API or ResizeObserver; KBarAnimator calls both (and ignores what they return)
  const hadAnimate = "animate" in Element.prototype;
  beforeEach(() => {
    vi.clearAllMocks();
    kbarQuery = undefined;
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 2, role: "USER" } } });
    if (!hadAnimate) {
      Object.defineProperty(Element.prototype, "animate", {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }
    if (typeof globalThis.ResizeObserver === "undefined") {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        }
      );
    }
  });

  afterEach(() => {
    if (!hadAnimate) {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only the no-results text and sends the query nowhere, Enter included", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <KBarRoot>
        <CaptureQuery />
        <KBarContent />
      </KBarRoot>
    );

    act(() => kbarQuery?.toggle());
    const input = await screen.findByPlaceholderText("kbar_search_placeholder");
    fireEvent.change(input, { target: { value: "qqxyzzy" } });

    expect(await screen.findByText("kbar_no_results_found")).toBeInTheDocument();
    expect(document.querySelector("a")).toBeNull();
    expect(screen.queryByText("kbar_search_help_desk_prefix")).toBeNull();
    expect(document.body.innerHTML).not.toContain("cal.com");

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(openSpy).not.toHaveBeenCalled();
  });
});
