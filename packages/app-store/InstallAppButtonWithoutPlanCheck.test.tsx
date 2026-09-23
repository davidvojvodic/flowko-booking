import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAppButtonWithoutPlanCheck } from "./InstallAppButtonWithoutPlanCheck";

const mutate = vi.hoisted(() => vi.fn());

vi.mock("@calcom/app-store/_utils/useAddAppMutation", () => ({
  default: () => ({ mutate, data: undefined }),
}));

vi.mock("./apps.browser.generated", () => ({ InstallAppButtonMap: {} }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

const notice = () => screen.queryByTestId("google-calendar-connect-notice");
const clickInstall = () => fireEvent.click(screen.getByRole("button", { name: "Install" }));

describe("InstallAppButtonWithoutPlanCheck", () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it("asks before sending the user to Google to connect Google Calendar", () => {
    render(
      <InstallAppButtonWithoutPlanCheck
        type="google_calendar"
        render={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Install
          </button>
        )}
      />
    );

    clickInstall();
    expect(mutate).not.toHaveBeenCalled();
    expect(notice()).not.toBeNull();

    fireEvent.click(screen.getByTestId("dialog-confirmation"));
    expect(mutate).toHaveBeenCalledWith({ type: "google_calendar" });
  });

  it("also holds back a click handler that the caller put in place of the default one", () => {
    const callerInstall = vi.fn();
    render(
      <InstallAppButtonWithoutPlanCheck
        type="google_calendar"
        render={({ useDefaultComponent, onClick }) => (
          <button type="button" onClick={useDefaultComponent ? callerInstall : onClick}>
            Install
          </button>
        )}
      />
    );

    clickInstall();
    expect(callerInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("dialog-confirmation"));
    expect(callerInstall).toHaveBeenCalledTimes(1);
  });

  it("installs other apps straight away", () => {
    render(
      <InstallAppButtonWithoutPlanCheck
        type="office365_calendar"
        render={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Install
          </button>
        )}
      />
    );

    clickInstall();
    expect(mutate).toHaveBeenCalledWith({ type: "office365_calendar" });
    expect(notice()).toBeNull();
  });
});
