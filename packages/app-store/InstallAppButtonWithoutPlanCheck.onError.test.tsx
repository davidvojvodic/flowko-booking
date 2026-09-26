import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UseAddAppMutationOptions } from "@calcom/app-store/_utils/useAddAppMutation";

import { InstallAppButtonWithoutPlanCheck } from "./InstallAppButtonWithoutPlanCheck";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  options: undefined as UseAddAppMutationOptions | undefined,
}));

vi.mock("@calcom/app-store/_utils/useAddAppMutation", () => ({
  default: (_type: unknown, options: UseAddAppMutationOptions) => {
    mocks.options = options;
    return { mutate: vi.fn(), data: undefined };
  },
}));

vi.mock("./apps.browser.generated", () => ({ InstallAppButtonMap: {} }));

vi.mock("@calcom/ui/components/toast", () => ({
  showToast: (...args: unknown[]) => mocks.showToast(...args),
}));

const SL = {
  google_calendar_connections_unavailable: "Povezovanje koledarjev trenutno ni na voljo. Poskusite znova pozneje.",
  app_could_not_be_installed: "Aplikacije ni bilo mogoče namestiti",
} as Record<string, string>;

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => SL[key] ?? key }),
}));

const renderConnectButton = (options?: UseAddAppMutationOptions) =>
  render(
    <InstallAppButtonWithoutPlanCheck
      type="google_calendar"
      options={options}
      render={({ onClick }) => (
        <button type="button" onClick={onClick}>
          Connect
        </button>
      )}
    />
  );

const defaultOnError = () => {
  const onError = mocks.options?.onError as ((error: unknown) => void) | undefined;
  expect(onError).toBeTypeOf("function");
  return onError as (error: unknown) => void;
};

describe("InstallAppButtonWithoutPlanCheck: a refused connect is not silent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.options = undefined;
  });

  it("shows the add route's localised 503 message when the caller has no onError", () => {
    renderConnectButton();

    defaultOnError()(new Error(SL.google_calendar_connections_unavailable));

    expect(mocks.showToast).toHaveBeenCalledWith(SL.google_calendar_connections_unavailable, "error");
  });

  it.each([
    ["an unknown (raw English) server message", new Error("You must be logged in to do this")],
    ["an error without a message", new Error("")],
    ["something that is not an Error", undefined],
  ])("shows the localised generic message for %s", (_label, error) => {
    renderConnectButton({ returnTo: "https://example.com/back" });

    defaultOnError()(error);

    expect(mocks.showToast).toHaveBeenCalledWith(SL.app_could_not_be_installed, "error");
    expect(mocks.showToast).not.toHaveBeenCalledWith("You must be logged in to do this", "error");
  });

  it("keeps the caller's own onError and the rest of its options", () => {
    const callerOnError = vi.fn();
    const onSuccess = vi.fn();
    renderConnectButton({ onError: callerOnError, onSuccess, returnTo: "https://example.com/back" });

    expect(mocks.options?.onError).toBe(callerOnError);
    expect(mocks.options?.onSuccess).toBe(onSuccess);
    expect(mocks.options?.returnTo).toBe("https://example.com/back");

    (mocks.options?.onError as (error: unknown) => void)(new Error("boom"));
    expect(callerOnError).toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
