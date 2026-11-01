import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MorePage from "./more-page-view";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/web/modules/shell/Shell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/web/modules/shell/navigation/Navigation", () => ({ MobileNavigationMoreItems: () => <ul /> }));
vi.mock("@calcom/web/modules/shell/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

describe("/more (Flowko U14)", () => {
  it("offers the language switcher on a phone", () => {
    render(<MorePage />);

    expect(screen.getByTestId("language-switcher")).toBeInTheDocument();
  });
});
