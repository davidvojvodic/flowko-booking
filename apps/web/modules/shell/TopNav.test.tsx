// Flowko U28: the phone top bar's logo goes to the desk for a business member, to the event types for anyone else.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopNavContainer } from "./TopNav";

const mockMe = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: { viewer: { flowko: { business: { me: { useQuery: () => mockMe() } } } } },
}));
vi.mock("@calcom/embed-core/embed-iframe", () => ({ useIsEmbed: () => false }));
vi.mock("@calcom/lib/hooks/useIsStandalone", () => ({ useIsStandalone: () => false }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/ui/components/logo", () => ({ Logo: () => null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: {} }) }));
vi.mock("./Kbar", () => ({ KBarTrigger: () => null }));
vi.mock("./user-dropdown/UserDropdown", () => ({ UserDropdown: () => null }));

const logoHref = (): string | null => {
  const { container } = render(<TopNavContainer />);
  return container.querySelector("nav a")?.getAttribute("href") ?? null;
};

describe("TopNav logo (U28)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("goes to /koledar for a business member", () => {
    mockMe.mockReturnValue({ data: { role: "STAFF", hidesCalScreens: true } });
    expect(logoHref()).toBe("/koledar");
  });

  it("goes to /event-types for a user in no business and while loading", () => {
    mockMe.mockReturnValue({ data: null });
    expect(logoHref()).toBe("/event-types");
    document.body.innerHTML = "";
    mockMe.mockReturnValue({ data: undefined });
    expect(logoHref()).toBe("/event-types");
  });
});
