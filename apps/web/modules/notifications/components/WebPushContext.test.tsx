import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (U13, David 2026-09-27): the service worker is for signed-in hosts' push notifications only, so a visitor
// (a booking page opened directly, or an embed on a client's website with session={null}) never gets one.

const mocks = vi.hoisted(() => ({
  status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: mocks.status, data: null }) }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      loggedInViewerRouter: {
        addNotificationsSubscription: { useMutation: () => ({ mutate: vi.fn() }) },
        removeNotificationsSubscription: { useMutation: () => ({ mutate: vi.fn() }) },
      },
    },
  },
}));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));

import { WebPushProvider } from "./WebPushContext";

const register = vi.fn(() => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } }));

describe("WebPushProvider service worker", () => {
  beforeEach(() => {
    register.mockClear();
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
  });
  afterEach(() => {
    cleanup();
    // @ts-expect-error test cleanup of the stubbed property
    delete navigator.serviceWorker;
  });

  it("registers nothing for a visitor without a session", () => {
    mocks.status = "unauthenticated";
    render(<WebPushProvider>x</WebPushProvider>);
    expect(register).not.toHaveBeenCalled();
  });

  it("registers nothing while the session is still loading", () => {
    mocks.status = "loading";
    render(<WebPushProvider>x</WebPushProvider>);
    expect(register).not.toHaveBeenCalled();
  });

  it("registers the service worker once for a signed-in host", () => {
    mocks.status = "authenticated";
    render(<WebPushProvider>x</WebPushProvider>);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/service-worker.js");
  });
});
