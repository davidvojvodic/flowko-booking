import { metadata as googleCalendar } from "@calcom/app-store/googlecalendar/_metadata";
import { metadata as zoom } from "@calcom/app-store/zoomvideo/_metadata";
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import type { AppFrontendPayload } from "@calcom/types/App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { AppCard } from "./AppCard";

const locale = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => locale.current,
}));
vi.mock("next/navigation", () => ({
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
  usePathname: vi.fn(),
}));

// A real i18next instance with the app's en and sl strings, falling back to English as the app does.
const useLanguage = (lng: string) => {
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
  locale.current = { t: i18n.getFixedT(lng, "common"), i18n, isLocaleReady: true };
};

const asCard = (meta: typeof googleCalendar): AppFrontendPayload =>
  ({ ...meta, logo: `/app-store/${meta.dirName}/${meta.logo}` }) as AppFrontendPayload;

const renderCard = (app: AppFrontendPayload) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppCard app={app} />
    </QueryClientProvider>
  );

const ENGLISH =
  "Connect Google Calendar so that customers cannot book appointments when you are busy, and so that every booking is added to your calendar automatically, updated when it changes and deleted when it is cancelled.";
const SLOVENIAN =
  "Povežite Google Calendar, da stranke ne morejo rezervirati terminov, ko ste zasedeni, in da se vsaka rezervacija samodejno doda v vaš koledar, ob spremembi posodobi in ob odpovedi izbriše.";

// Flowko: Google Calendar's card described the app in Slovenian to hosts using the English interface.
describe("AppCard description", () => {
  it("shows an English user Google Calendar's English description", () => {
    useLanguage("en");
    renderCard(asCard(googleCalendar));

    expect(screen.getByText(ENGLISH)).toBeInTheDocument();
    expect(screen.queryByText(SLOVENIAN)).toBeNull();
  });

  it("shows a Slovenian user Google Calendar's Slovenian description", () => {
    useLanguage("sl");
    renderCard(asCard(googleCalendar));

    expect(screen.getByText(SLOVENIAN)).toBeInTheDocument();
    expect(screen.queryByText(ENGLISH)).toBeNull();
  });

  it("shows a user of another language Google Calendar's English description", () => {
    useLanguage("de");
    renderCard(asCard(googleCalendar));

    expect(screen.getByText(ENGLISH)).toBeInTheDocument();
  });

  it.each(["en", "sl"])("shows another app's own description unchanged in %s", (lng) => {
    useLanguage(lng);
    renderCard(asCard(zoom as typeof googleCalendar));

    expect(screen.getByText(zoom.description)).toBeInTheDocument();
  });
});
