import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import { metadata as googleCalendar } from "../googlecalendar/_metadata";
import { metadata as zoom } from "../zoomvideo/_metadata";
import { getAppDescription } from "./getAppDescription";

// A real i18next instance with the app's en and sl strings, falling back to English as the app does.
const translatorFor = (lng: string) => {
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
  return i18n.getFixedT(lng, "common");
};

const ENGLISH =
  "Connect Google Calendar so that customers cannot book appointments when you are busy, and so that every booking is added to your calendar automatically, updated when it changes and deleted when it is cancelled.";
// The U9 Slovenian short description, unchanged.
const SLOVENIAN =
  "Povežite Google Calendar, da stranke ne morejo rezervirati terminov, ko ste zasedeni, in da se vsaka rezervacija samodejno doda v vaš koledar, ob spremembi posodobi in ob odpovedi izbriše.";

describe("getAppDescription", () => {
  it("shows Google Calendar's description in English to an English user", () => {
    expect(getAppDescription(googleCalendar, translatorFor("en"))).toBe(ENGLISH);
  });

  it("shows Google Calendar's description in Slovenian to a Slovenian user", () => {
    expect(getAppDescription(googleCalendar, translatorFor("sl"))).toBe(SLOVENIAN);
  });

  it("shows Google Calendar's description in English in any other language", () => {
    expect(getAppDescription(googleCalendar, translatorFor("de"))).toBe(ENGLISH);
  });

  it("keeps the metadata description equal to the English string", () => {
    expect(googleCalendar.description).toBe(ENGLISH);
    expect(en.google_calendar_app_description).toBe(ENGLISH);
  });

  it.each(["en", "sl", "de"])("leaves another app's description unchanged in %s", (lng) => {
    expect(getAppDescription(zoom, translatorFor(lng))).toBe(zoom.description);
  });

  it("does not translate by any key other than Google Calendar's", () => {
    const requested: string[] = [];
    const t = ((key: string) => {
      requested.push(key);
      return key;
    }) as unknown as Parameters<typeof getAppDescription>[1];

    expect(getAppDescription({ slug: "constructor", description: "Upstream text" }, t)).toBe("Upstream text");
    expect(getAppDescription(zoom, t)).toBe(zoom.description);
    expect(requested).toEqual([]);

    expect(getAppDescription(googleCalendar, t)).toBe("google_calendar_app_description");
    expect(requested).toEqual(["google_calendar_app_description"]);
  });
});
