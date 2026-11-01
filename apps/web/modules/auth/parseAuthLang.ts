/**
 * Flowko U14: the sign-in pages are Slovene unless the address says ?lang=en. Only the exact string counts, so ?lang=de,
 * ?lang=../x and a repeated ?lang=en&lang=sl (an array on the server) all mean Slovene. Nothing is stored.
 */
export function parseAuthLang(value: unknown): "en" | null {
  return value === "en" ? "en" : null;
}

/** The same reading on the client, where `get` would return the first of a repeated parameter. */
export function authLangFromUrl(searchParams: Pick<URLSearchParams, "getAll"> | null | undefined) {
  const values = searchParams?.getAll("lang") ?? [];
  return parseAuthLang(values.length === 1 ? values[0] : null);
}

/** A link to another sign-in page that keeps the language. */
export function withAuthLang(href: string, lang: "en" | null) {
  return lang ? `${href}?lang=${lang}` : href;
}
