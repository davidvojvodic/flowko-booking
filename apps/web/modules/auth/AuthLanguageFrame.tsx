import { getTranslation, loadTranslations } from "@calcom/i18n/server";
import type { SearchParams } from "app/_types";
import { CustomI18nProvider } from "app/CustomI18nProvider";
import type { ReactNode } from "react";

import { AuthLanguageSwitch } from "./AuthLanguageSwitch";
import { parseAuthLang } from "./parseAuthLang";

/**
 * Flowko U14: a sign-in or forgot-password page with its SL / EN switch, in English for ?lang=en and otherwise in the
 * root layout's language.
 */
export async function renderWithAuthLanguage({
  pathname,
  searchParams,
  children,
}: {
  pathname: string;
  searchParams: SearchParams;
  children: ReactNode;
}) {
  const lang = parseAuthLang(searchParams.lang);
  const page = (
    <>
      <AuthLanguageSwitch pathname={pathname} searchParams={searchParams} />
      {children}
    </>
  );
  if (!lang) return page;

  const ns = "common";
  const translations = await loadTranslations(lang, ns);
  return (
    <CustomI18nProvider translations={translations} locale={lang} ns={ns}>
      {page}
    </CustomI18nProvider>
  );
}

/** For generateMetadata: the English `t` for ?lang=en, so the browser title follows, otherwise null. */
export async function getAuthLangTranslate(searchParams: SearchParams) {
  const lang = parseAuthLang(searchParams.lang);
  return lang ? await getTranslation(lang, "common") : null;
}
