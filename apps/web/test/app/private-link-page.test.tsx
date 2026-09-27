import { CustomI18nProvider } from "app/CustomI18nProvider";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (U13 fix pass): the private link's booking page (/d/<link>/<slug>) speaks the event type's
// language like /:user/:type (U13-25). Before, a private-link booker saw it in their browser's language and
// the success page (/booking/<uid>) in the owner's. This file lives outside apps/web/app on purpose:
// pagesAndRewritePaths.ts scans the file names there as top-level routes.

const mocks = vi.hoisted(() => ({
  getEventTypePageLocale: vi.fn(),
  loadTranslations: vi.fn(),
  pageProps: {
    eventData: { id: 42, interfaceLanguage: null as string | null, title: "Pregled" },
    slug: "pregled",
    user: "flowko-test",
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyCtx: () => ({}) }));
vi.mock("app/WithAppDirSsr", () => ({ withAppDirSsr: () => async () => mocks.pageProps }));
vi.mock("app/_utils", () => ({ _generateMetadata: vi.fn() }));
vi.mock("@lib/d/[link]/[slug]/getServerSideProps", () => ({ getServerSideProps: vi.fn() }));
vi.mock("@lib/booking/getBookerPageLocale", () => ({ getEventTypePageLocale: mocks.getEventTypePageLocale }));
vi.mock("@calcom/i18n/server", () => ({ loadTranslations: mocks.loadTranslations }));
vi.mock("@calcom/web/modules/d/[link]/d-type-view", () => ({ default: function Type() { return null; } }));

async function renderPage() {
  const { default: ServerPage } = await import("app/(booking-page-wrapper)/d/[link]/[slug]/page");
  return (await ServerPage({
    params: Promise.resolve({ link: "a1b2c3", slug: "pregled" }),
    searchParams: Promise.resolve({}),
  } as never)) as ReactElement<{ locale?: string; translations?: unknown; children?: ReactElement }>;
}

describe("/d/<link>/<slug> page language (Flowko U13 fix pass)", () => {
  beforeEach(() => {
    mocks.getEventTypePageLocale.mockReset();
    mocks.loadTranslations.mockReset();
    mocks.loadTranslations.mockResolvedValue({ book: "Rezerviraj" });
  });

  it("asks for the event type's page language with its interface language and id", async () => {
    mocks.getEventTypePageLocale.mockResolvedValue(null);
    await renderPage();

    expect(mocks.getEventTypePageLocale).toHaveBeenCalledWith({ interfaceLanguage: null, eventTypeId: 42 });
  });

  it("wraps the booker in the event type's language (the owner's while it is off)", async () => {
    mocks.getEventTypePageLocale.mockResolvedValue("sl");
    const page = await renderPage();

    expect(page.type).toBe(CustomI18nProvider);
    expect(page.props.locale).toBe("sl");
    expect(page.props.translations).toEqual({ book: "Rezerviraj" });
    expect(mocks.loadTranslations).toHaveBeenCalledWith("sl", "common");
    const booker = page.props.children as ReactElement<typeof mocks.pageProps>;
    expect(booker.props).toMatchObject(mocks.pageProps);
  });

  it("keeps the root layout's language when there is none (the visitor's browser language)", async () => {
    mocks.getEventTypePageLocale.mockResolvedValue(null);
    const page = await renderPage();

    expect(page.type).not.toBe(CustomI18nProvider);
    expect(page.props).toMatchObject(mocks.pageProps);
    expect(mocks.loadTranslations).not.toHaveBeenCalled();
  });
});
