import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeToCalcomModal } from "./WelcomeToCalcomModal";

const mockCloseModal: Mock = vi.fn();
vi.mock("../hooks/useWelcomeToCalcomModal", () => ({
  useWelcomeToCalcomModal: () => ({ isOpen: true, closeModal: mockCloseModal }),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

// Flowko: the welcome modal after onboarding must promise only what this instance offers (only google-calendar is
// enabled) and must not link out to cal.diy
describe("WelcomeToCalcomModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only the features this instance offers", () => {
    render(<WelcomeToCalcomModal />);
    const dialog = screen.getByRole("dialog");

    for (const key of ["unlimited_calendars", "unlimited_event_types", "html_react_embed"]) {
      expect(within(dialog).getByText(key)).toBeInTheDocument();
    }
    for (const key of [
      "integrate_with_favorite_apps",
      "accept_payments_via_stripe",
      "cal_ai_phone_agent",
      "cal_video",
    ]) {
      expect(within(dialog).queryByText(key)).toBeNull();
    }
  });

  it("has no link out; Continue is its only control, keeps focus on Tab and closes the modal", async () => {
    render(<WelcomeToCalcomModal />);
    const dialog = screen.getByRole("dialog");

    expect(dialog.querySelector("a")).toBeNull();
    expect(within(dialog).queryByText("learn_more")).toBeNull();
    expect(dialog.innerHTML).not.toContain("cal.diy");

    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["continue"]);
    const continueButton = buttons[0];

    await waitFor(() => expect(document.activeElement).toBe(continueButton));
    // The focus trap loops Tab from the last control to the first; upstream's first was the invisible cal.diy link
    fireEvent.keyDown(continueButton, { key: "Tab" });
    expect(document.activeElement).toBe(continueButton);

    fireEvent.click(continueButton);
    expect(mockCloseModal).toHaveBeenCalledTimes(1);
  });
});
