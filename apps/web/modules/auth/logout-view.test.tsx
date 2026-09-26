import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logout } from "./logout-view";

const state = vi.hoisted(() => ({
  status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
  strings: {} as Record<string, string>,
  push: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signOut: state.signOut,
  useSession: () => ({ status: state.status }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => state.strings[key] ?? key }),
}));

vi.mock("@calcom/web/components/ui/AuthContainer", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="auth-container">{children}</div>,
}));

vi.mock("@calcom/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    "data-testid": testId,
  }: {
    children: ReactNode;
    onClick?: () => void;
    "data-testid"?: string;
  }) => (
    <button type="button" onClick={onClick} data-testid={testId}>
      {children}
    </button>
  ),
}));

vi.mock("@coss/ui/icons", () => ({
  CheckIcon: () => <span data-testid="check-icon" />,
}));

describe("Logout (Flowko)", () => {
  beforeEach(() => {
    state.status = "unauthenticated";
    state.strings = en as unknown as Record<string, string>;
    state.push.mockReset();
    state.signOut.mockReset();
  });

  it("stays on the logged-out page for ?survey=true instead of redirecting to /cancellation", () => {
    render(<Logout query={{ survey: "true" }} />);

    expect(state.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: en.youve_been_logged_out })).toBeInTheDocument();
    expect(screen.getByText(en.hope_to_see_you_soon)).toBeInTheDocument();
  });

  it("shows the logged-out page in Slovenian after a plain logout", () => {
    state.strings = sl as unknown as Record<string, string>;
    render(<Logout query={{}} />);

    expect(state.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: sl.youve_been_logged_out })).toBeInTheDocument();
    expect(screen.getByText(sl.hope_to_see_you_soon)).toBeInTheDocument();
    expect(screen.getByTestId("logout-btn")).toHaveTextContent(sl.go_back_login);
  });

  it("keeps the password-reset and email-change messages", () => {
    const { unmount } = render(<Logout query={{ passReset: "true" }} />);
    expect(screen.getByText(en.reset_your_password)).toBeInTheDocument();
    unmount();

    render(<Logout query={{ emailChange: "true" }} />);
    expect(screen.getByText(en.email_change)).toBeInTheDocument();
  });

  it("still ends a live session without a redirect", () => {
    state.status = "authenticated";
    render(<Logout query={{ survey: "true" }} />);

    expect(state.signOut).toHaveBeenCalledWith({ redirect: false });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("goes to the login page only when the button is pressed", () => {
    render(<Logout query={{}} />);

    fireEvent.click(screen.getByTestId("logout-btn"));

    expect(state.push).toHaveBeenCalledTimes(1);
    expect(state.push).toHaveBeenCalledWith("/auth/login");
  });
});
