import { describe, expect, it } from "vitest";

import { formatLocalizedDay } from "./formatLocalizedDate";

describe("formatLocalizedDay", () => {
  const date = new Date("2026-11-01T10:00:00Z");

  it("prints Slovene month names with sl", () => {
    expect(formatLocalizedDay(date, "sl", { day: "numeric", month: "long", year: "numeric" })).toBe(
      "1. november 2026"
    );
    expect(formatLocalizedDay(date, "sl", { weekday: "long" })).toBe("nedelja");
  });

  it("prints English month names with en", () => {
    expect(formatLocalizedDay(date, "en", { day: "numeric", month: "short", year: "numeric" })).toBe(
      "Nov 1, 2026"
    );
  });

  it("takes a dayjs-like value and keeps the time zone it is given", () => {
    const late = { toDate: () => new Date("2026-11-01T23:30:00Z") };
    expect(formatLocalizedDay(late, "en", { day: "numeric", month: "short" })).toBe("Nov 1");
    expect(formatLocalizedDay(late, "en", { day: "numeric", month: "short" }, "Europe/Ljubljana")).toBe("Nov 2");
  });
});
