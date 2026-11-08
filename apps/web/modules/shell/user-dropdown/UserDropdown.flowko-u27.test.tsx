// Flowko U27: a non-owner business member's account menu has no "Out of office" item; the other items stay.
import { render } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserDropdown } from "./UserDropdown";

const mockHides = vi.fn();
vi.mock("@calcom/web/lib/flowko/useFlowkoHidesCalScreens", () => ({
  useFlowkoHidesCalScreens: () => mockHides(),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  SUPPORT_MAIL_ADDRESS: "support@example.com",
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/trpc/react/hooks/useMeQuery", () => ({
  default: () => ({ data: { username: "ana", name: "Ana", avatarUrl: null, avatar: null }, isPending: false }),
}));
vi.mock("@calcom/ui/components/avatar", () => ({ Avatar: () => <div /> }));
vi.mock("@calcom/ui/classNames", () => ({
  default: (...args: string[]) => args.filter(Boolean).join(" "),
}));
vi.mock("@coss/ui/components/menu", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const item = ({ children, render }: { children: React.ReactNode; render?: React.ReactElement }) =>
    render ? React.cloneElement(render, {}, children) : <div>{children}</div>;
  return {
    Menu: passthrough,
    MenuTrigger: ({ children, render }: { children: React.ReactNode; render?: React.ReactElement }) =>
      render ? React.cloneElement(render, {}, children) : <div>{children}</div>,
    MenuPopup: passthrough,
    MenuItem: item,
    MenuSeparator: () => <hr />,
    MenuSub: passthrough,
    MenuSubTrigger: passthrough,
    MenuSubPopup: passthrough,
  };
});

const hrefs = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("UserDropdown Cal screens (U27)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the Out of office item to a user who is not hidden", () => {
    mockHides.mockReturnValue(false);
    const { container } = render(<UserDropdown />);
    expect(hrefs(container)).toContain("/settings/my-account/out-of-office");
  });

  it("leaves the Out of office item out for a non-owner member and keeps the rest", () => {
    mockHides.mockReturnValue(true);
    const { container, getByText } = render(<UserDropdown />);
    expect(hrefs(container)).toEqual([
      "/settings/my-account/profile",
      "/settings/my-account/general",
      "mailto:support@example.com",
    ]);
    expect(getByText("sign_out")).toBeInTheDocument();
  });
});
