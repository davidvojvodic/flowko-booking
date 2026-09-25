/**
 * Flowko: the booker form shows a failed booking's message by translating it as a key (BookEventForm's getError
 * calls t(error.message, { date, count })), so a code the booker can hit needs a string in each language the
 * instance serves, or the form shows the raw key.
 */
import { getTranslation } from "@calcom/i18n/server";
import { describe, expect, it } from "vitest";

import { ErrorCode } from "./errorCodes";

describe("ErrorCode.LocationNotOffered", () => {
  it.each([
    ["en", "This location isn't offered for this event. Please choose one of the listed locations."],
    ["sl", "Ta lokacija za ta dogodek ni na voljo. Izberite eno od navedenih lokacij."],
  ])("reads as a sentence in %s, the way the booker form translates it", async (locale, text) => {
    const t = await getTranslation(locale, "common");

    expect(ErrorCode.LocationNotOffered).toBe("location_not_offered_error");
    expect(t(ErrorCode.LocationNotOffered, { date: "", count: 0 })).toBe(text);
  });
});
