import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SideBar } from "./SideBar";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, isLocaleReady: true }),
}));
vi.mock("@calcom/lib/hooks/useIsStandalone", () => ({ useIsStandalone: () => false }));
vi.mock("@calcom/ui/components/credits", () => ({ Credits: () => null }));
vi.mock("@calcom/ui/components/logo", () => ({ Logo: () => null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: {} }) }));
vi.mock("./Kbar", () => ({ KBarTrigger: () => null }));
vi.mock("./navigation/Navigation", () => ({ Navigation: () => null }));
vi.mock("./useBottomNavItems", () => ({
  useBottomNavItems: () => [{ name: "settings", href: "/settings/my-account/profile", icon: "settings" }],
}));
vi.mock("./user-dropdown/ProfileDropdown", () => ({ ProfileDropdown: () => null }));
vi.mock("./user-dropdown/UserDropdown", () => ({ UserDropdown: () => null }));
vi.mock("./LanguageSwitcher", () => ({
  LanguageSwitcher: ({ className }: { className?: string }) => (
    <div data-testid="language-switcher" className={className} />
  ),
}));

describe("SideBar: the language switcher (Flowko U14)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sits below the Settings item, at lg only: the collapsed tablet rail shows none", () => {
    render(
      <TooltipProvider>
        <SideBar bannersHeight={0} user={null} />
      </TooltipProvider>
    );

    const switcher = screen.getByTestId("language-switcher");
    const settings = screen.getByRole("link", { name: "settings" });
    expect(settings.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(switcher.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "lg:flex"]));
  });
});
