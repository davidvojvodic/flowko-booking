/* eslint-disable @typescript-eslint/no-var-requires */
const { i18n } = require("@calcom/i18n/next-i18next.config");

// Workaround for using router.locales from old router
export const locales = i18n.locales as string[];

// Flowko U14: the lists a person chooses from offer the two languages the product is written in. `locales` above keeps
// every language, because a stored language or a visitor's browser may still ask for another one.
export const localeOptions = [
  { value: "sl", label: "Slovenščina" },
  { value: "en", label: "English" },
];

export const defaultLocaleOption = localeOptions.find(
  (locale) => locale.value === i18n.defaultLocale
) as (typeof localeOptions)[number];
