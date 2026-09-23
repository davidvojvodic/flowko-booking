import { describe, expect, it } from "vitest";
import { getTimeFormatForLocale, TimeFormat } from "./timeFormat";

describe("getTimeFormatForLocale", () => {
  it("returns 12h for English", () => {
    expect(getTimeFormatForLocale("en")).toBe(TimeFormat.TWELVE_HOUR);
  });

  it("returns 24h for a locale that uses a 24-hour clock", () => {
    expect(getTimeFormatForLocale("sl")).toBe(TimeFormat.TWENTY_FOUR_HOUR);
  });

  it("falls back to 12h for a malformed locale", () => {
    expect(getTimeFormatForLocale("en_US")).toBe(TimeFormat.TWELVE_HOUR);
  });
});
