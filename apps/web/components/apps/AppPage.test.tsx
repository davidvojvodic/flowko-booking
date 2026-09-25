import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { SUPPORT_MAIL_ADDRESS } from "@calcom/lib/constants";
import { render } from "@testing-library/react";
import { createInstance } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppPage, type AppPageProps } from "./AppPage";

const locale = vi.hoisted(() => ({
  current: undefined as unknown,
  requestedKeys: [] as string[],
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => locale.current,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@calcom/lib/hooks/useCompatSearchParams", () => ({
  useCompatSearchParams: () => new URLSearchParams(),
}));
// The query results are stable objects: AppPage copies them into state in an effect keyed on `data`.
const queries = vi.hoisted(() => ({
  credentials: { data: { credentials: [], userAdminTeams: [] }, isPending: false, refetch: () => undefined },
  dependencies: { data: undefined, isPending: false },
}));
vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    useUtils: () => ({ viewer: { apps: { appCredentialsByType: { invalidate: vi.fn() } } } }),
    viewer: {
      apps: {
        appCredentialsByType: { useQuery: () => queries.credentials },
        queryForDependencies: { useQuery: () => queries.dependencies },
      },
    },
  },
}));
vi.mock("@calcom/app-store/_utils/useAddAppMutation", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@calcom/app-store/InstallAppButton", () => ({
  InstallAppButton: () => null,
}));
vi.mock("@calcom/app-store/AppDependencyComponent", () => ({
  AppDependencyComponent: () => null,
}));
vi.mock("@calcom/app-store/_components/GoogleCalendarConnectNotice", () => ({
  GOOGLE_CALENDAR_APP_TYPE: "google_calendar",
  useGoogleCalendarConnectNotice: () => ({ dialog: null, requestConsent: vi.fn() }),
}));
vi.mock("@calcom/app-store/utils", () => ({
  doesAppSupportTeamInstall: () => false,
  isConferencing: () => false,
}));
vi.mock("@calcom/web/modules/apps/components/DisconnectIntegration", () => ({ default: () => null }));
vi.mock("./MultiDisconnectIntegration", () => ({ MultiDisconnectIntegration: () => null }));
vi.mock("./InstallAppButtonChild", () => ({ InstallAppButtonChild: () => null }));

// A real i18next instance with the app's en and sl strings, so a missing key behaves as it does in the app.
const useLanguage = (lng: "en" | "sl") => {
  const i18n = createInstance();
  i18n.init({
    lng,
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    resources: { en: { common: en }, sl: { common: sl } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  const fixedT = i18n.getFixedT(lng, "common");
  const t = (key: string, options?: Record<string, unknown>) => {
    locale.requestedKeys.push(key);
    return fixedT(key, options);
  };
  locale.current = { t, i18n, isLocaleReady: true };
};

const googleCalendarProps: AppPageProps = {
  name: "Google Calendar",
  description: "",
  type: "google_calendar",
  logo: "/app-store/googlecalendar/logo.webp",
  slug: "google-calendar",
  variant: "calendar",
  body: <p>body</p>,
  categories: ["calendar"],
  author: "Flowko",
  website: "https://flowko.si/",
  email: "rezervacije@flowko.si",
  licenseRequired: false,
  descriptionItems: [],
  concurrentMeetings: undefined,
};

const categoryChip = (category = "calendar") => document.querySelector(`a[href="categories/${category}"]`);

describe("AppPage", () => {
  beforeEach(() => {
    locale.requestedKeys = [];
  });

  describe.each(["en", "sl"] as const)("in %s", (lng) => {
    beforeEach(() => useLanguage(lng));

    // Flowko: the footer claimed every app is open source and reviewed by experts, and linked a
    // "report app" mailto; neither is true of a single-operator service.
    it("renders no app-review footer and no report link", () => {
      const { container } = render(<AppPage {...googleCalendarProps} />);
      const strings = lng === "en" ? en : sl;

      expect(locale.requestedKeys).not.toContain("every_app_published");
      expect(locale.requestedKeys).not.toContain("report_app");
      expect(container.textContent).not.toContain(strings.report_app);
      // "Every app published on the " / "Vsaka aplikacija, objavljena v trgovini "
      expect(container.textContent).not.toContain(strings.every_app_published.split("{{")[0]);
      expect(container.querySelector(`a[href="mailto:${SUPPORT_MAIL_ADDRESS}"]`)).toBeNull();
      expect(container.querySelector("hr")).toBeNull();
      // The app's own contact e-mail is still listed.
      expect(container.querySelector('a[href="mailto:rezervacije@flowko.si"]')).not.toBeNull();
    });
  });

  it("shows the category chip in Slovenian on the Slovenian page", () => {
    useLanguage("sl");
    render(<AppPage {...googleCalendarProps} />);

    expect(categoryChip()?.textContent).toBe("Koledar");
  });

  it("shows the category chip in English on the English page", () => {
    useLanguage("en");
    render(<AppPage {...googleCalendarProps} />);

    expect(categoryChip()?.textContent).toBe("Calendar");
  });

  it("falls back to the raw category id when the category has no translation", () => {
    useLanguage("sl");
    render(<AppPage {...googleCalendarProps} categories={["video", "conferencing"]} />);

    expect(categoryChip("video")?.textContent).toBe("video");
  });
});
