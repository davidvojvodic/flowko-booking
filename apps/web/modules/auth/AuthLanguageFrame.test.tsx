import { CustomI18nProvider } from "app/CustomI18nProvider";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthLangTranslate, renderWithAuthLanguage } from "./AuthLanguageFrame";

const mocks = vi.hoisted(() => ({ loadTranslations: vi.fn(), getTranslation: vi.fn() }));

vi.mock("@calcom/i18n/server", () => ({
  loadTranslations: mocks.loadTranslations,
  getTranslation: mocks.getTranslation,
}));
vi.mock("./AuthLanguageSwitch", () => ({ AuthLanguageSwitch: () => null }));

const frame = (lang: unknown) =>
  renderWithAuthLanguage({
    pathname: "/auth/login",
    searchParams: { lang } as never,
    children: <main />,
  }) as Promise<ReactElement<{ locale?: string; ns?: string; translations?: unknown }>>;

describe("renderWithAuthLanguage (Flowko U14)", () => {
  beforeEach(() => {
    mocks.loadTranslations.mockReset();
    mocks.loadTranslations.mockResolvedValue({ login: "Login" });
    mocks.getTranslation.mockReset();
  });

  it("wraps the page in English for ?lang=en", async () => {
    const page = await frame("en");

    expect(page.type).toBe(CustomI18nProvider);
    expect(page.props.locale).toBe("en");
    expect(page.props.translations).toEqual({ login: "Login" });
    expect(mocks.loadTranslations).toHaveBeenCalledWith("en", "common");
  });

  it.each([["de"], ["../x"], [["en", "sl"]], [undefined]])(
    "leaves the page in the layout's language for lang=%j",
    async (lang) => {
      const page = await frame(lang);

      expect(page.type).not.toBe(CustomI18nProvider);
      expect(mocks.loadTranslations).not.toHaveBeenCalled();
    }
  );
});

describe("getAuthLangTranslate", () => {
  beforeEach(() => {
    mocks.getTranslation.mockReset();
    mocks.getTranslation.mockResolvedValue((key: string) => `en:${key}`);
  });

  it("gives the English t for ?lang=en, so the browser title follows", async () => {
    const t = await getAuthLangTranslate({ lang: "en" });

    expect(t?.("login")).toBe("en:login");
    expect(mocks.getTranslation).toHaveBeenCalledWith("en", "common");
  });

  it.each([["de"], [["en", "sl"]], [undefined]])("gives nothing for lang=%j", async (lang) => {
    await expect(getAuthLangTranslate({ lang } as never)).resolves.toBeNull();
    expect(mocks.getTranslation).not.toHaveBeenCalled();
  });
});

// Loading these pages here would pull in their whole server dependencies, so this pins the wiring in each.
describe("the pages", () => {
  const read = (file: string) => readFileSync(resolve(__dirname, "../..", file), "utf8");

  it.each([
    ["app/(use-page-wrapper)/auth/login/page.tsx", 'pathname: "/auth/login"'],
    ["app/(use-page-wrapper)/auth/forgot-password/page.tsx", 'pathname: "/auth/forgot-password"'],
    ["app/(use-page-wrapper)/auth/forgot-password/[id]/page.tsx", "pathname: `/auth/forgot-password/${"],
  ])("%s has the switch, the language and the browser title", (file, pathname) => {
    const source = read(file);

    expect(source).toContain("await renderWithAuthLanguage({");
    expect(source).toContain(pathname);
    expect(source).toContain("searchParams: resolvedSearchParams");
    expect(source).toContain("getAuthLangTranslate(await searchParams)");
    expect(source).not.toMatch(/\(t\) => t\(/);
  });

  it("login's forgot-password link carries the language", () => {
    expect(read("modules/auth/login-view.tsx")).toContain(
      'href={withAuthLang("/auth/forgot-password", authLangFromUrl(searchParams))}'
    );
  });
});
