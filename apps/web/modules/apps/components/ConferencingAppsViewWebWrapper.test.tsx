import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { InstalledConferencingApps } from "./ConferencingAppsViewWebWrapper";

const mockShowToast = vi.fn();
vi.mock("@calcom/ui/components/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => `t(${key})` }),
}));

type AppListProps = {
  handleUpdateUserDefaultConferencingApp: (params: {
    appSlug: string;
    appLink?: string;
    onSuccessCallback: () => void;
    onErrorCallback: () => void;
  }) => void;
  handleBulkUpdateDefaultLocation: (params: { eventTypeIds: number[]; callback: () => void }) => void;
};
let appListProps: AppListProps | undefined;
vi.mock("@calcom/features/apps/components/AppList", () => ({
  AppList: (props: AppListProps) => {
    appListProps = props;
    return null;
  },
}));

vi.mock("@calcom/features/apps/components/DisconnectIntegrationModal", () => ({ default: () => null }));
vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({ default: () => null }));
vi.mock("@calcom/web/modules/apps/components/AppListCardWebWrapper", () => ({ default: () => null }));

type MutateOptions = { onSuccess?: () => void; onError?: (error: { message: string }) => void };
const updateDefaultAppMutate = vi.fn();
const bulkUpdateMutate = vi.fn();
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      viewer: {
        apps: {
          integrations: { invalidate: vi.fn() },
          getUsersDefaultConferencingApp: { invalidate: vi.fn() },
        },
      },
    }),
    viewer: {
      apps: {
        updateUserDefaultConferencingApp: {
          useMutation: () => ({ mutate: updateDefaultAppMutate, isPending: false }),
        },
      },
      eventTypes: {
        bulkUpdateToDefaultLocation: {
          useMutation: () => ({ mutate: bulkUpdateMutate, isPending: false }),
        },
      },
    },
  },
}));

const lastMutateOptions = (mutate: ReturnType<typeof vi.fn>): MutateOptions =>
  mutate.mock.calls[mutate.mock.calls.length - 1][1];

describe("InstalledConferencingApps error toasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appListProps = undefined;
    render(
      <InstalledConferencingApps
        disconnectIntegrationModalCtrl={{
          isModalOpen: () => false,
          credentialId: null,
          close: vi.fn(),
          disconnect: vi.fn(),
        }}
        integrations={{ items: [{ slug: "google-meet" }] } as never}
        defaultConferencingApp={undefined}
        eventTypes={[]}
      />
    );
  });

  it("translates a refused default-app change instead of showing the raw key", () => {
    const onErrorCallback = vi.fn();
    appListProps?.handleUpdateUserDefaultConferencingApp({
      appSlug: "google-meet",
      onSuccessCallback: vi.fn(),
      onErrorCallback,
    });
    lastMutateOptions(updateDefaultAppMutate).onError?.({ message: ErrorCode.AppNotAvailable });

    expect(mockShowToast).toHaveBeenCalledWith(`t(${ErrorCode.AppNotAvailable})`, "error");
    expect(onErrorCallback).toHaveBeenCalled();
  });

  it("tells the user why a bulk location update was refused and closes the dialog", () => {
    const callback = vi.fn();
    appListProps?.handleBulkUpdateDefaultLocation({ eventTypeIds: [1, 2], callback });
    lastMutateOptions(bulkUpdateMutate).onError?.({ message: ErrorCode.AppNotAvailable });

    expect(mockShowToast).toHaveBeenCalledWith(`t(${ErrorCode.AppNotAvailable})`, "error");
    expect(callback).toHaveBeenCalled();
  });
});
