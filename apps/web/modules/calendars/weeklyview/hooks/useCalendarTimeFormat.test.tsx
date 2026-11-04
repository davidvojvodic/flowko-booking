import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeFormat } from "@calcom/lib/timeFormat";

const storeTimeFormat = vi.hoisted(() => ({ value: undefined as TimeFormat | undefined }));

vi.mock("@calcom/features/calendars/weeklyview/state/store", () => ({
  useCalendarStore: (selector: (s: { timeFormat?: TimeFormat }) => unknown) =>
    selector({ timeFormat: storeTimeFormat.value }),
}));
vi.mock("@calcom/features/bookings/lib", () => ({
  // the booker store: browser-detected, 12-hour in an en-US browser
  useTimePreferences: () => ({ timeFormat: TimeFormat.TWELVE_HOUR }),
}));

import { useCalendarTimeFormat } from "./useCalendarTimeFormat";

// Flowko U19: the host's calendar follows the profile's time format, not the browser's.
describe("useCalendarTimeFormat", () => {
  it("uses the format handed to the calendar", () => {
    storeTimeFormat.value = TimeFormat.TWENTY_FOUR_HOUR;
    expect(renderHook(() => useCalendarTimeFormat()).result.current).toBe(TimeFormat.TWENTY_FOUR_HOUR);
  });

  it("falls back to the booker's preference when the calendar got none", () => {
    storeTimeFormat.value = undefined;
    expect(renderHook(() => useCalendarTimeFormat()).result.current).toBe(TimeFormat.TWELVE_HOUR);
  });
});
