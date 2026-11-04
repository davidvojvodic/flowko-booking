import { describe, expect, it } from "vitest";

import { localizeHolidayCountries } from "./holidayCountryNames";

const t = (key: string) => `t(${key})`;
const COUNTRIES = [
  { code: "CHRISTIAN", name: "Christian Holidays" },
  { code: "AT", name: "Austria" },
  { code: "SI", name: "Slovenia" },
  { code: "HR", name: "Croatia" },
  { code: "DE", name: "Germany" },
];

// Flowko U19: the holidays country list follows the app language, Slovenia first.
describe("localizeHolidayCountries", () => {
  it("names countries in Slovene, puts Slovenia first, then the rest in Slovene order", () => {
    expect(localizeHolidayCountries(COUNTRIES, "sl", t).map((c) => c.name)).toEqual([
      "Slovenija",
      "t(flowko_holiday_calendar_christian)",
      "Avstrija",
      "Hrvaška",
      "Nemčija",
    ]);
  });

  it("keeps the codes", () => {
    expect(localizeHolidayCountries(COUNTRIES, "sl", t)[0].code).toBe("SI");
  });

  it("names countries in English for an English app", () => {
    const names = localizeHolidayCountries(COUNTRIES, "en", t).map((c) => c.name);
    expect(names.slice(0, 1)).toEqual(["Slovenia"]);
    expect(names).toContain("Croatia");
  });
});
