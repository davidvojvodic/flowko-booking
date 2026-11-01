import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { createInstance } from "i18next";

/** A real i18next instance with the app's en and sl files (English as fallback), for tests that check wording. */
export function realTranslator(lng: "sl" | "en") {
  const i18n = createInstance();
  i18n.init({
    lng,
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    resources: { en: { common: en }, sl: { common: sl } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return { t: i18n.getFixedT(lng, "common"), i18n };
}
