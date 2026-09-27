"use client";

import { dir } from "i18next";
import { createContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

type CustomI18nContextType = {
  translations: Record<string, string>;
  ns: string;
  locale: string;
};

export const CustomI18nContext = createContext<CustomI18nContextType | null>(null);

/**
 * Flowko (U13-19): the root layout sets `<html lang dir>` from the visitor's Accept-Language, but a booker
 * page wrapped in this provider speaks the event type's language (`interfaceLanguage`), so
 * /flowko-test/ogled was served as lang="en" around Slovenian text and screen readers read it with English
 * rules. Point `lang` and `dir` at this locale while the page is mounted and put the layout's values back
 * when it unmounts (a client-side navigation to a page without this provider).
 */
function useDocumentLocale(locale: string) {
  useEffect(() => {
    if (!locale) return;
    const html = document.documentElement;
    const previousLang = html.getAttribute("lang");
    const previousDir = html.getAttribute("dir");
    const direction = dir(locale);
    html.setAttribute("lang", locale);
    html.setAttribute("dir", direction);
    return () => {
      // Restore only what is still ours, so a provider that mounted after this one keeps its values.
      if (html.getAttribute("lang") === locale) {
        if (previousLang === null) html.removeAttribute("lang");
        else html.setAttribute("lang", previousLang);
      }
      if (html.getAttribute("dir") === direction) {
        if (previousDir === null) html.removeAttribute("dir");
        else html.setAttribute("dir", previousDir);
      }
    };
  }, [locale]);
}

export function CustomI18nProvider({
  children,
  translations,
  locale,
  ns,
}: CustomI18nContextType & {
  children: ReactNode;
}) {
  // Memoize the value to prevent re-renders unless the data changes
  const value = useMemo(
    () => ({
      translations,
      locale,
      ns,
    }),
    [locale, ns]
  );

  useDocumentLocale(locale);

  return <CustomI18nContext.Provider value={value}>{children}</CustomI18nContext.Provider>;
}
