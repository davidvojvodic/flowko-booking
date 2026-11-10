import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { ActionTree } from "kbar";
import { useKBar } from "kbar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerLeaveGuard } from "@calcom/web/lib/flowko/leaveGuard"; // Flowko U29c
import { KBarContent, KBarRoot } from "./Kbar";

const mockUseSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

const mockEventTypes = vi.fn(() => ({ data: undefined as unknown }));
const mockBookings = vi.fn(() => ({ data: undefined as unknown }));
const mockPush = vi.fn();
// Flowko U29c: a stable router object, as in the app (the bookings action memoises on it)
const mockRouter = { push: mockPush };
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));

// Flowko U27: the Cal-screens flag; an owner (not hidden) here, so the cases below are unchanged
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => false,
}));

// Flowko U28 (R16 f): the business state; a user in no business here, so the cases below are unchanged
vi.mock("@calcom/web/lib/flowko/useFlowkoBusiness", () => ({
  useFlowkoBusiness: () => ({ status: "none", me: null }),
}));

vi.mock("@calcom/app-store/appStoreMetaData", () => ({ appStoreMetadata: {} }));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      eventTypes: { getEventTypesFromGroup: { useInfiniteQuery: () => mockEventTypes() } },
      bookings: { get: { useQuery: () => mockBookings() } }, // Flowko U29c: per-test data (default: none)
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

// Flowko U29c (P5): every router.push of the palette goes through the leave guard. No guard: the plain, synchronous
// push (pinned above). A guard (Urnik while dirty): it is asked one tick later and the push waits for `go`.
describe("Kbar leave guard (U29c P5)", () => {
  const hadAnimate = "animate" in Element.prototype;
  let kbarQuery: ReturnType<typeof useKBar>["query"] | undefined;
  let visualState: string | undefined;
  let release: (() => void) | undefined;
  const guard = vi.fn((go: () => void) => {
    release = go;
  });

  function Probe(): JSX.Element {
    const { query, visual } = useKBar((state) => ({ visual: state.visualState }));
    kbarQuery = query;
    visualState = visual;
    return <div data-testid="visual">{visual}</div>;
  }
  // stands in for Urnik's dialog: the guard opens it, and nothing else touches the palette
  function GuardDialog(): JSX.Element | null {
    const [open, setOpen] = useState(false);
    useEffect(
      () =>
        registerLeaveGuard((go) => {
          guard(go);
          setOpen(true);
        }),
      []
    );
    return open ? <div role="dialog" aria-label="Neshranjene spremembe" /> : null;
  }
  const probedTree = (withDialog: boolean): JSX.Element => (
    <KBarRoot>
      <Probe />
      <RegisteredActionIds />
      {withDialog ? <GuardDialog /> : null}
      <KBarContent />
    </KBarRoot>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    kbarQuery = undefined;
    visualState = undefined;
    release = undefined;
    registeredActions = {};
    if (!hadAnimate) {
      Object.defineProperty(Element.prototype, "animate", { value: vi.fn(), configurable: true, writable: true });
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
    cleanup();
    if (!hadAnimate) delete (Element.prototype as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    mockEventTypes.mockReturnValue({ data: undefined });
    mockBookings.mockReturnValue({ data: undefined });
  });

  it("the static (KBarRoot), admin and Cal-screen actions ask the guard, not the router", async () => {
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 1, role: "ADMIN" } } });
    const off = registerLeaveGuard(guard);
    renderKbar();
    await waitFor(() => expect(registeredIds()).toContain("webhooks"));
    expect(registeredIds()).toContain("event-types");

    vi.useFakeTimers();
    registeredActions["api-keys"].command?.perform(); // static: KBarRoot
    registeredActions.webhooks.command?.perform(); // admin
    registeredActions["event-types"].command?.perform(); // Cal screen
    expect(mockPush).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5));
    expect(guard).toHaveBeenCalledTimes(3);
    expect(mockPush).not.toHaveBeenCalled();

    guard.mock.calls[1][0]();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/settings/developer/webhooks");
    off();
  });

  it("an event-type and a booking action ask the guard, not the router", async () => {
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 2, role: "USER" } } });
    mockEventTypes.mockReturnValue({ data: { pages: [{ eventTypes: [{ id: 7, title: "Cut" }] }] } });
    mockBookings.mockReturnValue({
      data: {
        bookings: [
          { uid: "abc", title: "Fen", startTime: "2026-11-16T09:00:00Z", attendees: [{ name: "Ana" }] },
        ],
      },
    });
    const off = registerLeaveGuard(guard);
    render(probedTree(false));
    act(() => kbarQuery?.toggle()); // both register inside the palette's portal
    await waitFor(() => expect(Object.keys(registeredActions)).toEqual(expect.arrayContaining(["event-type-7"])));
    expect(Object.keys(registeredActions)).toContain("booking-abc");

    vi.useFakeTimers();
    registeredActions["event-type-7"].command?.perform();
    registeredActions["booking-abc"].command?.perform();
    expect(mockPush).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5));
    expect(guard).toHaveBeenCalledTimes(2);
    guard.mock.calls[0][0]();
    guard.mock.calls[1][0]();
    expect(mockPush.mock.calls).toEqual([["/event-types/7"], ["/booking/abc"]]);
    off();
  });

  it("no guard: an event-type action pushes at once", async () => {
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 2, role: "USER" } } });
    mockEventTypes.mockReturnValue({ data: { pages: [{ eventTypes: [{ id: 7, title: "Cut" }] }] } });
    render(probedTree(false));
    act(() => kbarQuery?.toggle());
    // registeredActions is filled by RegisteredActionIds, which sits outside the portal
    await waitFor(() => expect(Object.keys(registeredActions)).toContain("event-type-7"));
    registeredActions["event-type-7"].command?.perform();
    expect(mockPush).toHaveBeenCalledWith("/event-types/7");
  });

  // kbar runs `perform(); query.toggle()` on Enter and click. Flowko code must not toggle the palette (that would
  // flip it back open); the guard opens one tick later.
  it("Enter on a result: the palette ends hidden (not re-opened) and the guard's dialog is open", async () => {
    mockUseSession.mockReturnValue({ status: "authenticated", data: { user: { id: 2, role: "USER" } } });
    const off = registerLeaveGuard(guard);
    render(probedTree(true));
    act(() => kbarQuery?.toggle());
    const input = await screen.findByPlaceholderText("kbar_search_placeholder");
    fireEvent.change(input, { target: { value: "api_keys" } });
    await waitFor(() => expect(document.querySelector('[role="option"][aria-selected="true"]')).not.toBeNull());

    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(["animating-out", "hidden"]).toContain(visualState); // kbar's own toggle closed it
    expect(mockPush).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(["animating-out", "hidden"]).toContain(visualState); // still closed after the guard ran
    expect(screen.getByRole("dialog", { name: "Neshranjene spremembe" })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    release?.();
    expect(mockPush).toHaveBeenCalledTimes(1);
    off();
  });

  it("no useKBar is added: the guard module does not import kbar and Kbar.tsx keeps its two upstream calls", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const guardSource = readFileSync(resolve(__dirname, "../../lib/flowko/leaveGuard.ts"), "utf8");
    expect(guardSource).not.toMatch(/from "kbar"/);
    const kbarSource = readFileSync(resolve(__dirname, "Kbar.tsx"), "utf8");
    expect(kbarSource.match(/useKBar\(/g)).toHaveLength(2); // KBarTrigger and RenderResults, both upstream
    expect(kbarSource).not.toMatch(/router\.push\(|configToAction\(config, router\.push\)|buildKbarActions\(router\.push\)/);
    expect(kbarSource.match(/const push = useGuardedPush\(\)/g)).toHaveLength(5); // KBarRoot + the four action hooks
  });
});
