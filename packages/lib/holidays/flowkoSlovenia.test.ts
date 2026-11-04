import { describe, expect, it } from "vitest";

import { GOOGLE_HOLIDAY_CALENDARS } from "./constants";
import { DEFAULT_HOLIDAY_EMOJI, getHolidayEmoji } from "./getHolidayEmoji";

// Flowko U19: Slovenia reads Google's Slovene official calendar, and its names get an emoji.
describe("Slovenian holidays", () => {
  it("SI uses the Slovene official calendar (Slovene names)", () => {
    expect(GOOGLE_HOLIDAY_CALENDARS.SI.calendarId).toBe(
      "sl.slovenian.official#holiday@group.v.calendar.google.com"
    );
  });

  // the 13 names Google's sl.slovenian.official calendar served on 2026-11-04
  it.each([
    ["Novo leto", "🎆"],
    ["Prešernov dan", "📜"],
    ["Velika noč", "🐣"],
    ["Velikonočni ponedeljek", "🐣"],
    ["Dan upora proti okupatorju", "🕊️"],
    ["Praznik dela", "👷"],
    ["Binkoštna nedelja", "🕊️"],
    ["Dan državnosti", "🏛️"],
    ["Marijino vnebovzetje", "✝️"],
    ["Dan reformacije", "✝️"],
    ["Dan spomina na mrtve", "🕯️"],
    ["Božič", "🎄"],
    ["Dan samostojnosti in enotnosti", "🤝"],
  ])("%s → %s", (name, emoji) => {
    expect(getHolidayEmoji(name)).toBe(emoji);
  });

  it("English names keep their upstream emoji", () => {
    expect(getHolidayEmoji("Christmas Day")).toBe("🎄");
    expect(getHolidayEmoji("Something unknown")).toBe(DEFAULT_HOLIDAY_EMOJI);
  });
});
