import dayjs from "@calcom/dayjs";
import { describe, expect, it } from "vitest";
import { formatSpanBoundary } from "./formatSpanBoundary";

describe("formatSpanBoundary (Flowko)", () => {
  const value = dayjs("2026-11-03T23:00:00");

  it("shows only the time for a span within one day", () => {
    expect(formatSpanBoundary(value, false, "sl")).toBe("23:00");
  });

  it("shows the date in Slovenian for a span over several days", () => {
    expect(formatSpanBoundary(value, true, "sl")).toBe("3. nov., 23:00");
  });

  it("keeps the English form for English", () => {
    expect(formatSpanBoundary(value, true, "en")).toBe("Nov 3, 23:00");
  });
});
