import { cleanup, render } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (U13, David 2026-09-27): the service worker is for signed-in hosts' push notifications only, so a visitor
// (a booking page opened directly, or an embed on a client's website with session={null}) never gets one.

const mocks = vi.hoisted(() => ({
  status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
  showToast: vi.fn(),
  useLocale: vi.fn(),
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
vi.mock("@calcom/ui/components/toast", () => ({ showToast: mocks.showToast }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: mocks.useLocale }));

import { WebPushContext, WebPushProvider } from "./WebPushContext";

const register = vi.fn(() => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } }));

// Flowko U14: the provider sits above AppRouterI18nProvider in app/layout.tsx, where useLocale has no translations
// and a toast would show the raw key, so the caller hands in its own t.
describe("WebPushProvider's language", () => {
  afterEach(cleanup);

  it("doesn't use useLocale, and says a failure with the t it is given", async () => {
    mocks.status = "unauthenticated";
    Object.defineProperty(globalThis, "Notification", {
      value: { permission: "default", requestPermission: () => Promise.reject(new Error("no")) },
      configurable: true,
    });
    let context: React.ContextType<typeof WebPushContext> = null;
    const Capture = () => {
      context = useContext(WebPushContext);
      return null;
    };
    render(
      <WebPushProvider>
        <Capture />
      </WebPushProvider>
    );

    await (context as unknown as { subscribe: (t: (key: string) => string) => Promise<void> }).subscribe(
      (key) => `translated:${key}`
    );

    expect(mocks.useLocale).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith("translated:notifications_enable_failed", "error");
  });
});

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
