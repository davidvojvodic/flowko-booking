import { describe, expect, it } from "vitest";
import { getRecipientTimeFormat, getTimeFormatForLocale, TimeFormat } from "./timeFormat";

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

describe("getRecipientTimeFormat", () => {
  it("keeps an explicit 24h format", () => {
    expect(getRecipientTimeFormat(TimeFormat.TWENTY_FOUR_HOUR, "en")).toBe(TimeFormat.TWENTY_FOUR_HOUR);
  });

  it("uses the recipient's locale over the 12h default", () => {
    expect(getRecipientTimeFormat(TimeFormat.TWELVE_HOUR, "sl")).toBe(TimeFormat.TWENTY_FOUR_HOUR);
    expect(getRecipientTimeFormat(TimeFormat.TWELVE_HOUR, "en")).toBe(TimeFormat.TWELVE_HOUR);
  });

  it("uses the recipient's locale when no format is set", () => {
    expect(getRecipientTimeFormat(undefined, "sl")).toBe(TimeFormat.TWENTY_FOUR_HOUR);
    expect(getRecipientTimeFormat(undefined, "en")).toBe(TimeFormat.TWELVE_HOUR);
  });
});
