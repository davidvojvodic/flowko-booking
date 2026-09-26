import en from "@calcom/i18n/locales/en/common.json";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  headers: vi.fn(),
  cookies: vi.fn(),
  pageWrapperProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.getServerSession }));
// generateMetadata's translation helpers are not under test here
vi.mock("app/_utils", () => ({ _generateMetadata: vi.fn() }));
vi.mock("../components/PageWrapperAppDir", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => {
    mocks.pageWrapperProps.push(props);
    return <>{children}</>;
  },
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => (en as unknown as Record<string, string>)[key] ?? key }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/someuser" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import ServerPage from "./not-found";

const requestCookies = [{ name: "next-auth.session-token", value: "test-session-cookie" }];

async function renderPage() {
  return render(await ServerPage());
}

function homeHref() {
  return screen.getByRole("link", { name: /Or go back home/ }).getAttribute("href");
}

describe("not-found page (Flowko): the home link follows the server-side session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pageWrapperProps = [];
    mocks.headers.mockResolvedValue(new Headers({ "x-csp-nonce": "test-nonce" }));
    mocks.cookies.mockResolvedValue({ getAll: () => requestCookies });
  });

  it("links a signed-in host to this app's root", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: 9 } });

    await renderPage();

    expect(homeHref()).toBe("/");
  });

  it("looks the session up from the request's own headers and cookies", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    await renderPage();

    expect(mocks.getServerSession).toHaveBeenCalledTimes(1);
    const { req } = mocks.getServerSession.mock.calls[0][0];
    expect(req.cookies).toEqual({ "next-auth.session-token": "test-session-cookie" });
    expect(req.headers).toMatchObject({ "x-csp-nonce": "test-nonce" });
  });

  it.each([
    ["no session", null],
    ["a session without a user", {}],
    ["a session user without an id", { user: {} }],
  ])("links a visitor with %s to https://flowko.si", async (_label, session) => {
    mocks.getServerSession.mockResolvedValue(session);

    await renderPage();

    expect(homeHref()).toBe("https://flowko.si");
  });

  it.each([
    ["rejects", () => mocks.getServerSession.mockRejectedValue(new Error("database unavailable"))],
    [
      "throws",
      () =>
        mocks.getServerSession.mockImplementation(() => {
          throw new Error("bad token");
        }),
    ],
  ])("still renders the 404 and treats the visitor as signed out when the lookup %s", async (_label, fail) => {
    fail();

    await expect(renderPage()).resolves.toBeDefined();

    expect(screen.getByTestId("404-page")).toBeInTheDocument();
    expect(homeHref()).toBe("https://flowko.si");
  });

  it("keeps passing the CSP nonce to the page wrapper", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    await renderPage();

    expect(mocks.pageWrapperProps).toEqual([{ requiresLicense: false, nonce: "test-nonce" }]);
  });
});
