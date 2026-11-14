// Flowko U29e (E10.1, R17): the one opt-out from i18next's escaping for Flowko client strings. The app-router
// useLocale keeps i18next's default (escapeValue true) and React escapes the result again, so a name such as
// „Ana & Maja“ would show as „Ana &amp; Maja“. Every client `t()` call that interpolates a name, a customer name,
// a service or holiday name, a date or a free text passes RAW: React then escapes once. Client-safe, no import.
// Never a global switch in useLocale (Cal core; the pages-router path would still escape).

/** Spread into `t(key, { name, ...RAW })` so i18next leaves the value as typed (React escapes it once). */
export const RAW = { interpolation: { escapeValue: false } } as const;
