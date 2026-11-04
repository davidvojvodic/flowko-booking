import { describe, expect, it } from "vitest";

import { previousTimeReleased } from "./flowkoPreviousTimeReleased";

describe("U17a previousTimeReleased", () => {
  it("is true for a booking moved from another one", () => {
    expect(previousTimeReleased({ rescheduledFromUid: "abc", seatsPerTimeSlot: null })).toBe(true);
  });

  it("is false for a booking that was not moved", () => {
    expect(previousTimeReleased({ rescheduledFromUid: null, seatsPerTimeSlot: null })).toBe(false);
    expect(previousTimeReleased({ rescheduledFromUid: undefined })).toBe(false);
    expect(previousTimeReleased({ rescheduledFromUid: "" })).toBe(false);
  });

  it("is false on a seated event type, where the original booking is not cancelled", () => {
    expect(previousTimeReleased({ rescheduledFromUid: "abc", seatsPerTimeSlot: 3 })).toBe(false);
  });
});
