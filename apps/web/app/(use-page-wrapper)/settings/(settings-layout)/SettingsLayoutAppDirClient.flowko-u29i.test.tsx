// Flowko U29i: on the phone the settings menu (drawer + backdrop) closes after a navigation inside the settings
// layout, so the page that opens is not left under the backdrop. The layout instance stays mounted between sibling
// settings pages; only the pathname changes. The full default export renders with a Shell mock that renders its slots.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsLayoutAppDirClient from "./SettingsLayoutAppDirClient";

const nav = vi.hoisted(() => ({ pathname: "/settings/my-account/profile" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@calcom/lib/hooks/useUrlMatchesCurrentUrl", () => ({ useUrlMatchesCurrentUrl: () => false }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, isLocaleReady: true, i18n: { language: "sl" } }),
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: 2, role: "USER" } } }),
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      me: { get: { useQuery: () => ({ data: { name: "Olga", avatarUrl: null } }) } },
      flowko: {
        business: {
          me: {
            useQuery: () => ({
              data: {
                businessId: 9,
                businessName: "Salon",
                businessSlug: "salon",
                memberId: 1,
                role: "OWNER",
                hidesCalScreens: false,
              },
            }),
          },
        },
      },
    },
  },
}));
vi.mock("~/shell/Shell", () => ({
  default: (props: {
    TopNavContainer?: React.ReactNode;
    SidebarContainer?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <div>
      {props.TopNavContainer}
      {props.SidebarContainer}
      {props.children}
    </div>
  ),
}));

const layout = () => <SettingsLayoutAppDirClient>page</SettingsLayoutAppDirClient>;
const backdrop = () => screen.queryByRole("button", { name: "hide_navigation" });
const drawer = () => screen.getByRole("navigation", { name: "settings_navigation" });

describe("SettingsLayoutAppDirClient phone drawer (U29i)", () => {
  beforeEach(() => {
    nav.pathname = "/settings/my-account/profile";
  });
  afterEach(() => cleanup());

  it("closes the backdrop and the drawer when the pathname changes", () => {
    const { rerender } = render(layout());
    expect(backdrop()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "show_navigation" }));
    expect(backdrop()).not.toBeNull();
    expect(drawer().className).toContain("translate-x-0");

    nav.pathname = "/settings/podjetje/profil";
    rerender(layout());

    expect(backdrop()).toBeNull();
    expect(drawer().className).toContain("-translate-x-full");
  });

  it("closes the menu for a Cal settings page as well, not only the business pages", () => {
    const { rerender } = render(layout());
    fireEvent.click(screen.getByRole("button", { name: "show_navigation" }));
    expect(backdrop()).not.toBeNull();

    nav.pathname = "/settings/my-account/general";
    rerender(layout());

    expect(backdrop()).toBeNull();
  });

  it("keeps a freshly opened menu open on a re-render with the same pathname", () => {
    const { rerender } = render(layout());
    fireEvent.click(screen.getByRole("button", { name: "show_navigation" }));
    expect(backdrop()).not.toBeNull();

    rerender(layout());

    expect(backdrop()).not.toBeNull();
    expect(drawer().className).toContain("translate-x-0");
  });
});
