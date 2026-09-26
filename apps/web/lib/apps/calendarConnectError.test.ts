import { describe, expect, it } from "vitest";

import en from "@calcom/i18n/locales/en/common.json";
import sl from "@calcom/i18n/locales/sl/common.json";

import { isCalendarConnectError } from "./calendarConnectError";

const CALLBACK_ERRORS = [
  "account_already_linked",
  "no_default_calendar",
  // Sent by the Google Calendar callback when it refuses a connect (U9)
  "google_calendar_connections_unavailable",
];

describe("isCalendarConnectError", () => {
  it.each(CALLBACK_ERRORS)("shows %s as a toast", (error) => {
    expect(isCalendarConnectError(error)).toBe(true);
  });

  it.each([
    ["an arbitrary value from a crafted link", "<b>anything the link says</b>"],
    ["another i18n key", "error_removing_app"],
    ["an empty value", ""],
    ["no value", undefined],
    ["null", null],
  ])("ignores %s", (_label, error) => {
    expect(isCalendarConnectError(error)).toBe(false);
  });

  it.each(CALLBACK_ERRORS)("%s is translated in English and Slovenian", (error) => {
    expect((en as Record<string, string>)[error]).toBeTruthy();
    expect((sl as Record<string, string>)[error]).toBeTruthy();
  });
});
