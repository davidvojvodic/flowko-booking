// Flowko U29a: test fixture for the settings views (not a test file): Flowko Test's settings as
// viewer.flowko.business.settings returns them, and a `t` backed by the real locale files that resolves i18next
// plurals (sl _one/_two/_few/_other, en _one/_other) the way i18next does when `count` is given.

import type { BusinessSettingsView } from "@calcom/features/flowkoBusiness/settings";
import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import type { OpeningHours } from "@calcom/lib/flowkoBusiness/schemas";

export const OPENING: OpeningHours = {
  mon: [{ from: "08:00", to: "20:00" }],
  tue: [{ from: "08:00", to: "20:00" }],
  wed: [{ from: "08:00", to: "20:00" }],
  thu: [{ from: "08:00", to: "20:00" }],
  fri: [{ from: "08:00", to: "20:00" }],
  sat: [{ from: "08:00", to: "13:00" }],
  sun: [],
};

export const UPDATED_AT = new Date("2026-11-16T07:00:00.000Z");

export const SETTINGS: BusinessSettingsView = {
  name: "Flowko Test",
  slug: "flowko-test",
  timeZone: "Europe/Ljubljana",
  phone: "+386 40 123 456",
  address: "Slovenska cesta 1, Ljubljana",
  email: "salon@example.si",
  openingHours: OPENING,
  slotGridMinutes: 15,
  holidaysClosed: true,
  reminderOffsets: [1440],
  sharedDevice: false,
  callPagePath: "/poklicite/flowko-test",
  updatedAt: UPDATED_AT,
};

export const localeStrings = {
  sl: sl as unknown as Record<string, string>,
  en: en as unknown as Record<string, string>,
};

/** A `t` over the real locale files: {{placeholder}} interpolation, and `count` picks the plural form first. */
export function localeT(lang: "sl" | "en" = "sl") {
  const strings = localeStrings[lang];
  const rules = new Intl.PluralRules(lang);
  return (key: string, opts?: Record<string, unknown>) => {
    const count = opts?.count;
    const plural = typeof count === "number" ? strings[`${key}_${rules.select(count)}`] : undefined;
    return (plural ?? strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
      String(opts?.[k] ?? "")
    );
  };
}
