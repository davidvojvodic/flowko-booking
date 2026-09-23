import { buildCalendarEvent, buildPerson } from "@calcom/lib/test/builder";
import { TimeFormat } from "@calcom/lib/timeFormat";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { formatRecipientDate, getFormattedDate } from "./date-formatting";

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

describe("getFormattedDate", () => {
  const buildEvent = (organizerTimeFormat: TimeFormat) =>
    buildCalendarEvent({
      startTime: "2026-10-23T12:00:00Z",
      endTime: "2026-10-23T13:00:00Z",
      organizer: buildPerson({ timeFormat: organizerTimeFormat }),
    });

  const buildAttendee = (locale: string, timeZone: string) =>
    buildPerson({ timeZone, language: { locale, translate: ((key: string) => key) as TFunction } });

  it("uses 24h times for a Slovenian attendee when the organizer keeps the 12h default", () => {
    expect(
      getFormattedDate(buildEvent(TimeFormat.TWELVE_HOUR), buildAttendee("sl", "Europe/Ljubljana"))
    ).toBe("14:00 - 15:00, petek, 23. oktober 2026");
  });

  it("keeps English output unchanged", () => {
    const attendee = buildAttendee("en", "America/New_York");
    expect(getFormattedDate(buildEvent(TimeFormat.TWELVE_HOUR), attendee)).toBe(
      "8:00am - 9:00am, Friday, October 23, 2026"
    );
    expect(getFormattedDate(buildEvent(TimeFormat.TWENTY_FOUR_HOUR), attendee)).toBe(
      "08:00 - 09:00, Friday, October 23, 2026"
    );
  });
});
