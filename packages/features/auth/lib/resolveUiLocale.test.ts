import { describe, expect, it } from "vitest";

import { resolveUiLocale } from "./resolveUiLocale";

describe("resolveUiLocale", () => {
  it("prefers the user's own SL / EN choice over their language", () => {
    expect(resolveUiLocale({ locale: "sl", metadata: { uiLanguage: "en" } })).toBe("en");
    expect(resolveUiLocale({ locale: "en", metadata: { uiLanguage: "sl" } })).toBe("sl");
  });

  it.each([
    ["no metadata", undefined],
    ["null metadata", null],
    ["metadata without a choice", { stripeCustomerId: "x" }],
    ["a language the switch doesn't offer", { uiLanguage: "de" }],
    ["a value that isn't a language", { uiLanguage: ["en"] }],
    ["metadata that isn't an object", "en"],
  ])("falls back to the language with %s", (_kind, metadata) => {
    expect(resolveUiLocale({ locale: "de", metadata })).toBe("de");
  });

  it("keeps a missing language missing", () => {
    expect(resolveUiLocale({ locale: null, metadata: {} })).toBeNull();
    expect(resolveUiLocale({ metadata: {} })).toBeUndefined();
  });
});
