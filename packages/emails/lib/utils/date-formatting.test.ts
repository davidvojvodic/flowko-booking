import { describe, expect, it } from "vitest";
import { formatRecipientDate } from "./date-formatting";

describe("formatRecipientDate", () => {
  const time = "2026-10-23T12:00:00Z";

  it("formats English dates as weekday, month day, year", () => {
    expect(formatRecipientDate({ time, timeZone: "America/New_York", locale: "en" })).toBe(
      "Friday, October 23, 2026"
    );
  });

  it("formats Slovenian dates in Slovenian order and case", () => {
    expect(formatRecipientDate({ time, timeZone: "Europe/Ljubljana", locale: "sl" })).toBe(
      "petek, 23. oktober 2026"
    );
  });

  it("uses the recipient's time zone for the day", () => {
    expect(
      formatRecipientDate({ time: "2026-10-23T23:30:00Z", timeZone: "Europe/Ljubljana", locale: "en" })
    ).toBe("Saturday, October 24, 2026");
  });

  it("falls back to English for a malformed locale", () => {
    expect(formatRecipientDate({ time, timeZone: "UTC", locale: "en_US" })).toBe("Friday, October 23, 2026");
  });
});
