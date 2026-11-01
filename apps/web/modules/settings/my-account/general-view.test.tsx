import { TooltipProvider } from "@radix-ui/react-tooltip";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GeneralView from "./general-view";

const mocks = vi.hoisted(() => ({
  options: {} as { onSuccess?: (res: { locale?: string }) => Promise<void> },
  update: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@calcom/features/settings/appDir/SettingsHeader", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/features/settings/SectionBottomActions", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "sl" } }),
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useContext: () => ({ viewer: { me: { invalidate: mocks.invalidate } } }),
    viewer: {
      me: {
        updateProfile: {
          useMutation: (options: typeof mocks.options) => {
            mocks.options = options;
            return { mutate: vi.fn() };
          },
        },
      },
    },
  },
}));
vi.mock("@calcom/web/app/cache/travelSchedule", () => ({ revalidateTravelSchedules: vi.fn() }));
vi.mock("@calcom/web/modules/timezone/components/TimezoneSelect", () => ({ TimezoneSelect: () => null }));
vi.mock("@components/settings/TravelScheduleModal", () => ({ default: () => null }));
vi.mock("app/(use-page-wrapper)/settings/(settings-layout)/my-account/general/actions", () => ({
  revalidateSettingsGeneral: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ update: mocks.update }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));

const renderView = (locale: string) =>
  render(
    <TooltipProvider>
      <GeneralView
        user={
          {
            locale,
            timeZone: "Europe/Ljubljana",
            timeFormat: 24,
            weekStart: "Monday",
            allowDynamicBooking: true,
            allowSEOIndexing: true,
            receiveMonthlyDigestEmail: false,
            requiresBookerEmailVerification: false,
            organizationSettings: null,
          } as never
        }
        travelSchedules={[]}
      />
    </TooltipProvider>
  );

describe("Settings → Splošno: language (Flowko U14)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.cookie = "calNewLocale=; path=/; max-age=0";
    mocks.update.mockResolvedValue(undefined);
  });

  it("explains how far this language reaches", () => {
    renderView("sl");

    expect(screen.getByText("language_setting_scope_hint")).toBeInTheDocument();
  });

  it("shows the stored language", () => {
    renderView("en");

    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("doesn't crash on a stored language the list no longer offers, and still names it", () => {
    renderView("de");

    expect(screen.getByText("de")).toBeInTheDocument();
  });

  it("no longer writes the calNewLocale cookie, and keeps window.calNewLocale", async () => {
    renderView("sl");

    await mocks.options.onSuccess?.({ locale: "en" });

    expect(document.cookie).not.toContain("calNewLocale");
    expect((window as unknown as { calNewLocale: string }).calNewLocale).toBe("en");
    expect(mocks.update).toHaveBeenCalledWith({ locale: "en" });
  });
});
