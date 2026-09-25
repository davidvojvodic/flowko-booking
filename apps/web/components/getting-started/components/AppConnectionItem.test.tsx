import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { AppConnectionItem } from "./AppConnectionItem";

const mockShowToast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => `t(${key})` }),
}));

vi.mock("@calcom/app-store/InstallAppButtonWithoutPlanCheck", () => ({
  InstallAppButtonWithoutPlanCheck: () => null,
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

let capturedOptions: { onError: (err: unknown) => void } | undefined;
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: { me: { invalidate: vi.fn() }, apps: { integrations: { invalidate: vi.fn() } } },
    }),
    viewer: {
      apps: {
        setDefaultConferencingApp: {
          useMutation: (options: { onError: (err: unknown) => void }) => {
            capturedOptions = options;
            return { mutate: vi.fn(), isPending: false };
          },
        },
      },
    },
  },
}));

const trpcError = (code: string, message: string) => ({ message, data: { code } });

describe("AppConnectionItem setDefaultConferencingApp onError", () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    capturedOptions = undefined;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppConnectionItem title="Cal Video" logo="/logo.svg" type="daily_video" installed slug="daily-video" />
    );
  });

  it("shows the disabled-app refusal instead of a generic error", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", ErrorCode.AppNotAvailable));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(`t(${ErrorCode.AppNotAvailable})`, "error");
  });

  it("keeps the generic message for any other error and never shows the server's text", () => {
    capturedOptions?.onError(trpcError("BAD_REQUEST", "Invalid app"));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith("t(something_went_wrong)", "error");
  });
});
