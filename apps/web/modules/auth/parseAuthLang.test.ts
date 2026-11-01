import { describe, expect, it } from "vitest";

import { authLangFromUrl, parseAuthLang, withAuthLang } from "./parseAuthLang";

describe("parseAuthLang (Flowko U14)", () => {
  it("accepts only the exact string en", () => {
    expect(parseAuthLang("en")).toBe("en");
  });

  it.each([
    ["sl, the default, which needs no parameter", "sl"],
    ["?lang=de", "de"],
    ["?lang=../x", "../x"],
    ["?lang=en&lang=sl", ["en", "sl"]],
    ["?lang=en&lang=en", ["en", "en"]],
    ["a single-item array", ["en"]],
    ["upper case", "EN"],
    ["padding", " en"],
    ["empty", ""],
    ["nothing", undefined],
    ["null", null],
    ["an object", { toString: () => "en" }],
  ])("ignores %s", (_kind, value) => {
    expect(parseAuthLang(value)).toBeNull();
  });
});

describe("authLangFromUrl", () => {
  it.each([
    ["lang=en", "en"],
    ["lang=de", null],
    ["lang=en&lang=sl", null],
    ["", null],
  ])("reads ?%s the way the page does", (query, expected) => {
    expect(authLangFromUrl(new URLSearchParams(query))).toBe(expected);
  });

  it("copes with no search params", () => {
    expect(authLangFromUrl(null)).toBeNull();
  });
});

describe("withAuthLang", () => {
  it("carries en to the next auth page", () => {
    expect(withAuthLang("/auth/forgot-password", "en")).toBe("/auth/forgot-password?lang=en");
  });

  it("leaves the link alone for Slovene", () => {
    expect(withAuthLang("/auth/forgot-password", null)).toBe("/auth/forgot-password");
  });
});
