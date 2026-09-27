import { act, cleanup, render, screen } from "@testing-library/react";
import type { SessionProviderProps } from "next-auth/react";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "vitest-fetch-mock";

// Flowko U13-10: an embed renders SessionProvider with a known null session, so next-auth never requests
// /api/auth/session (no csrf-token/callback-url cookies) and never writes nextauth.message to localStorage.

const mocks = vi.hoisted(() => ({
  sessionProviderProps: [] as Array<Omit<SessionProviderProps, "children">>,
  PassThrough: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("next-auth/react", async (importActual) => {
  const actual = await importActual<typeof import("next-auth/react")>();
  return {
    ...actual,
    // The real provider, with its props recorded
    SessionProvider: (props: SessionProviderProps) => {
      const { children: _children, ...rest } = props;
      mocks.sessionProviderProps.push(rest);
      return actual.SessionProvider(props);
    },
  };
});

vi.mock("app/_trpc/trpc-provider", () => ({ TrpcProvider: mocks.PassThrough }));
vi.mock("@coss/ui/components/toast", () => ({ ToastProvider: mocks.PassThrough }));
vi.mock("react-inlinesvg/provider", () => ({ default: mocks.PassThrough }));
vi.mock("@calcom/web/modules/notifications/components/WebPushContext", () => ({
  WebPushProvider: mocks.PassThrough,
}));
vi.mock("@calcom/web/components/notification-sound-handler", () => ({
  NotificationSoundHandler: () => null,
}));
vi.mock("@lib/hooks/useIsBookingPage", () => ({ default: () => true }));

import { Providers } from "./providers";

function SessionStatus() {
  const { status } = useSession();
  return <span data-testid="status">{status}</span>;
}

function renderProviders(isEmbed: boolean) {
  return render(
    <Providers isEmbed={isEmbed} nonce={undefined} country="SI">
      <SessionStatus />
    </Providers>
  );
}

const sessionRequests = () =>
  fetchMock.mock.calls.filter(([input]: [RequestInfo | URL, RequestInit?]) =>
    String(input instanceof Request ? input.url : input).includes("/api/auth/session")
  );

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Providers: session in embeds", () => {
  beforeEach(() => {
    mocks.sessionProviderProps.length = 0;
    fetchMock.resetMocks();
    fetchMock.mockResponse(JSON.stringify({}));
    window.localStorage.clear();
  });

  afterEach(async () => {
    // Let a pending session request settle before unmounting: next-auth keeps its state in a module singleton,
    // and a request resolving after the unmount would leave that state behind for the next test
    await flush();
    cleanup();
  });

  it("passes session={null} and switches refetching off for an embed", () => {
    renderProviders(true);
    const props = mocks.sessionProviderProps.at(-1);
    expect(props).toEqual({ session: null, refetchOnWindowFocus: false, refetchInterval: 0 });
  });

  it("makes no session request and writes no nextauth.message in an embed, even on focus", async () => {
    renderProviders(true);
    await flush();
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");

    // A visibilitychange is what upstream refetches on
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(sessionRequests()).toHaveLength(0);
    expect(window.localStorage.getItem("nextauth.message")).toBeNull();
  });

  it("leaves SessionProvider's props untouched outside an embed", () => {
    renderProviders(false);
    const props = mocks.sessionProviderProps.at(-1);
    expect(props).toEqual({});
    expect(props).not.toHaveProperty("session");
  });

  it("still fetches the session outside an embed (upstream behaviour)", async () => {
    renderProviders(false);
    await flush();

    expect(sessionRequests()).toHaveLength(1);
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    expect(window.localStorage.getItem("nextauth.message")).not.toBeNull();
  });
});
