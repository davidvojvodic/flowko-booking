import type { TFunction } from "i18next";

/**
 * Flowko: the i18n keys of the app short descriptions that are translated. Google Calendar's is in English and
 * Slovenian (other languages fall back to English), so the app store card, the calendar settings and the app
 * page's meta description follow the UI's language. Its `_metadata.ts` description is the English text.
 */
const TRANSLATED_APP_DESCRIPTION_KEYS = new Map<string, string>([
  ["google-calendar", "google_calendar_app_description"],
]);

/**
 * The short description of an app in the UI's language. Every app other than Google Calendar shows its
 * metadata description unchanged, as upstream does.
 */
export const getAppDescription = (app: { slug: string; description: string }, t: TFunction): string => {
  const key = TRANSLATED_APP_DESCRIPTION_KEYS.get(app.slug);
  return key ? t(key) : app.description;
};
