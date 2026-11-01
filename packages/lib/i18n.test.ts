import { describe, expect, it } from "vitest";

import { defaultLocaleOption, localeOptions, locales } from "./i18n";

// Flowko U14: the lists a person chooses from offer the two languages the product is written in.
describe("localeOptions", () => {
  it("offers Slovene and English, in that order", () => {
    expect(localeOptions.map((option) => option.value)).toEqual(["sl", "en"]);
    expect(localeOptions.map((option) => option.label)).toEqual(["Slovenščina", "English"]);
  });

  it("still knows every shipped language, for a stored or browser language", () => {
    expect(locales).toEqual(expect.arrayContaining(["sl", "en", "de", "ar", "pt-BR"]));
  });

  it("keeps a default option", () => {
    expect(defaultLocaleOption).toEqual({ value: "en", label: "English" });
  });
});
