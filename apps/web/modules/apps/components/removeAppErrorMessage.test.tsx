import { render } from "@testing-library/react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MultiDisconnectIntegration } from "@calcom/web/components/apps/MultiDisconnectIntegration";

import { ConferencingAppsViewWebWrapper } from "./ConferencingAppsViewWebWrapper";
import CredentialActionsDropdown from "./CredentialActionsDropdown";
import DisconnectIntegration from "./DisconnectIntegration";
import { removeAppErrorMessage } from "./removeAppErrorMessage";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  deleteMutate: vi.fn(),
  deleteHookOptions: [] as Array<{ onError?: (error: unknown) => void } | undefined>,
  removeAppProps: undefined as
    | { handleRemoveApp: (params: { credentialId: number; teamId?: number; callback: () => void }) => void }
    | undefined,
}));

vi.mock("@calcom/ui/components/toast", () => ({
  showToast: (...args: unknown[]) => mocks.showToast(...args),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => `t(${key})` }),
}));

vi.mock("@calcom/ui/components/disconnect-calendar-integration", () => ({
  DisconnectIntegrationComponent: () => null,
}));

vi.mock("@calcom/features/components/controlled-dialog", () => ({ Dialog: () => null }));
vi.mock("@calcom/features/apps/components/AppList", () => ({ AppList: () => null }));
vi.mock("@calcom/features/apps/components/DisconnectIntegrationModal", () => ({
  default: (props: typeof mocks.removeAppProps) => {
    mocks.removeAppProps = props;
    return null;
  },
}));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@calcom/web/modules/apps/components/AppListCardWebWrapper", () => ({ default: () => null }));

vi.mock("@calcom/trpc/react", () => {
  const invalidate = vi.fn();
  const utils = {
    viewer: {
      apps: { integrations: { invalidate }, getUsersDefaultConferencingApp: { invalidate } },
      calendars: { connectedCalendars: { invalidate } },
    },
  };
  return {
    trpc: {
      useUtils: () => utils,
      viewer: {
        credentials: {
          delete: {
            useMutation: (options?: { onError?: (error: unknown) => void }) => {
              mocks.deleteHookOptions.push(options);
              return { mutate: mocks.deleteMutate, isPending: false };
            },
          },
        },
        apps: {
          updateUserDefaultConferencingApp: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        },
        eventTypes: {
          bulkUpdateToDefaultLocation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        },
      },
    },
  };
});

// What tRPC hands the client for handleDeleteCredential's refusal (HttpError 409), worded by the stored locale
const refusal = {
  message: "This Google Calendar connection can't be removed right now. Please try again later.",
  data: { code: "CONFLICT", httpStatus: 409 },
};
const unexpectedFailure = { message: "Credential not found", data: { code: "INTERNAL_SERVER_ERROR" } };

const REFUSED_TOAST = "t(google_calendar_removal_unavailable)";
const GENERIC_TOAST = "t(error_removing_app)";

const t = ((key: string) => `t(${key})`) as unknown as TFunction;

describe("removeAppErrorMessage", () => {
  it("tells the host to try again later when the removal was refused (CONFLICT)", () => {
    expect(removeAppErrorMessage(refusal, t)).toBe(REFUSED_TOAST);
  });

  it.each([
    ["an unexpected server error", unexpectedFailure],
    ["an error without tRPC data (network)", { message: "Failed to fetch" }],
    ["an error with null data", { data: null }],
    ["no error at all", undefined],
  ])("keeps the generic message for %s", (_label, error) => {
    expect(removeAppErrorMessage(error, t)).toBe(GENERIC_TOAST);
  });
});

describe("disconnect buttons show the refusal instead of the generic error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteHookOptions.length = 0;
    mocks.removeAppProps = undefined;
  });

  const lastHookOnError = () => {
    const options = mocks.deleteHookOptions[mocks.deleteHookOptions.length - 1];
    expect(options?.onError).toBeTypeOf("function");
    return options?.onError as (error: unknown) => void;
  };

  it.each([
    ["DisconnectIntegration", () => render(<DisconnectIntegration credentialId={7} />)],
    ["CredentialActionsDropdown", () => render(<CredentialActionsDropdown credentialId={7} />)],
    ["MultiDisconnectIntegration", () => render(<MultiDisconnectIntegration credentials={[]} />)],
  ])("%s", (_name, renderComponent) => {
    renderComponent();
    const onError = lastHookOnError();

    onError(refusal);
    expect(mocks.showToast).toHaveBeenLastCalledWith(REFUSED_TOAST, "error");

    onError(unexpectedFailure);
    expect(mocks.showToast).toHaveBeenLastCalledWith(GENERIC_TOAST, "error");
  });

  it("the conferencing apps page", () => {
    render(
      <ConferencingAppsViewWebWrapper
        integrations={{ items: [] } as never}
        defaultConferencingApp={undefined}
        eventTypes={[]}
      />
    );
    const callback = vi.fn();
    mocks.removeAppProps?.handleRemoveApp({ credentialId: 7, callback });
    const [, mutateOptions] = mocks.deleteMutate.mock.calls[0] as [unknown, { onError: (e: unknown) => void }];

    mutateOptions.onError(refusal);
    expect(mocks.showToast).toHaveBeenLastCalledWith(REFUSED_TOAST, "error");
    expect(callback).toHaveBeenCalled();

    mutateOptions.onError(unexpectedFailure);
    expect(mocks.showToast).toHaveBeenLastCalledWith(GENERIC_TOAST, "error");
  });
});
