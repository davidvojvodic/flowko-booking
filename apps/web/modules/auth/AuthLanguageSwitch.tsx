"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { SearchParams } from "app/_types";
import Link from "next/link";

import { parseAuthLang } from "./parseAuthLang";

function buildHref(pathname: string, searchParams: SearchParams, lang: "sl" | "en") {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "lang" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  if (lang === "en") query.set("lang", "en");
  const queryString = query.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

/**
 * Flowko U14: SL / EN on the sign-in and forgot-password pages. A plain link per language that keeps every other
 * parameter, callbackUrl above all. No cookie, no storage.
 */
export function AuthLanguageSwitch({
  pathname,
  searchParams,
}: {
  pathname: string;
  searchParams: SearchParams;
}) {
  const { t } = useLocale();
  const active = parseAuthLang(searchParams.lang) ?? "sl";

  const link = (lang: "sl" | "en") => (
    <Link
      href={buildHref(pathname, searchParams, lang)}
      prefetch={false}
      lang={lang}
      aria-current={active === lang ? "true" : undefined}
      className={active === lang ? "font-semibold text-(--cal-brand)" : "text-subtle hover:text-emphasis"}>
      {lang.toUpperCase()}
    </Link>
  );

  return (
    <nav
      aria-label={t("language_switcher_label")}
      className="absolute right-4 top-4 z-10 flex items-center gap-1 text-sm">
      {link("sl")}
      <span className="text-subtle" aria-hidden="true">
        /
      </span>
      {link("en")}
    </nav>
  );
}
