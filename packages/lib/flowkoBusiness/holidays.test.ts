// Flowko U26: Slovenian work-free days (pure module; Easter-based days computed, the rest fixed).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { easterSunday, slovenianWorkFreeDays, workFreeDayOn } from "./holidays";

describe("easterSunday", () => {
  it.each([
    [2008, "2008-03-23"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"],
  ])("%i -> %s", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it("accepts the bounds 2000 and 2199", () => {
    expect(easterSunday(2000)).toBe("2000-04-23");
    expect(() => easterSunday(2199)).not.toThrow();
  });

  it.each([1999, 2200, 2026.5, Number.NaN])("refuses %s with a RangeError", (year) => {
    expect(() => easterSunday(year)).toThrow(RangeError);
  });
});

describe("slovenianWorkFreeDays", () => {
  const days = slovenianWorkFreeDays(2026);

  it("lists the 15 work-free days of 2026 in date order", () => {
    expect(days.map((d) => d.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-02-08",
      "2026-04-05",
      "2026-04-06",
      "2026-04-27",
      "2026-05-01",
      "2026-05-02",
      "2026-05-24",
      "2026-06-25",
      "2026-08-15",
      "2026-10-31",
      "2026-11-01",
      "2026-12-25",
      "2026-12-26",
    ]);
    expect([...days.map((d) => d.date)].sort()).toEqual(days.map((d) => d.date));
  });

  it("uses the names of the law", () => {
    expect(days.map((d) => d.name)).toEqual([
      "novo leto",
      "novo leto",
      "Prešernov dan, slovenski kulturni praznik",
      "velikonočna nedelja",
      "velikonočni ponedeljek",
      "dan upora proti okupatorju",
      "praznik dela",
      "praznik dela",
      "binkoštna nedelja",
      "dan državnosti",
      "Marijino vnebovzetje",
      "dan reformacije",
      "dan spomina na mrtve",
      "božič",
      "dan samostojnosti in enotnosti",
    ]);
  });

  it("has 15 entries in every supported year, sorted and unique", () => {
    for (const year of [2000, 2008, 2024, 2038, 2199]) {
      const list = slovenianWorkFreeDays(year);
      expect(list).toHaveLength(15);
      const dates = list.map((d) => d.date);
      expect([...dates].sort()).toEqual(dates);
      expect(new Set(dates).size).toBe(15);
      expect(dates.every((d) => d.startsWith(`${year}-`))).toBe(true);
    }
  });

  it("refuses a year outside 2000-2199", () => {
    expect(() => slovenianWorkFreeDays(1999)).toThrow(RangeError);
    expect(() => slovenianWorkFreeDays(2200)).toThrow(RangeError);
  });

  it("carries the same 13 distinct names as the U19 holiday-emoji list (law wording aside)", () => {
    const source = readFileSync(path.join(__dirname, "../holidays/flowkoSlovenia.test.ts"), "utf8");
    const u19 = [...source.matchAll(/^\s*\["([^"]+)", "/gm)].map((m) => m[1]);
    expect(u19).toHaveLength(13);
    const expected = u19
      .filter((n) => n !== "Velika noč" && n !== "Prešernov dan")
      .map((n) => n.toLowerCase())
      .concat(["velikonočna nedelja", "prešernov dan, slovenski kulturni praznik"])
      .sort();
    const actual = [...new Set(days.map((d) => d.name.toLowerCase()))].sort();
    expect(actual).toEqual(expected);
  });
});

describe("workFreeDayOn", () => {
  it("finds Pentecost and the Assumption in 2026", () => {
    expect(workFreeDayOn("2026-05-24")).toEqual({ date: "2026-05-24", name: "binkoštna nedelja" });
    expect(workFreeDayOn("2026-08-15")?.name).toBe("Marijino vnebovzetje");
  });

  it("returns null on a working day, including 23 November", () => {
    expect(workFreeDayOn("2026-11-23")).toBeNull();
    expect(workFreeDayOn("2026-03-02")).toBeNull();
  });

  it.each(["2026-13-01", "2026-02-30", "2026-1-01", "26-01-01", "", "2026-01-01T00:00", "1999-01-01", "2200-01-01"])(
    "throws a RangeError on %j",
    (date) => {
      expect(() => workFreeDayOn(date)).toThrow(RangeError);
    }
  );

  it("throws a RangeError on a non-string", () => {
    expect(() => workFreeDayOn(undefined as unknown as string)).toThrow(RangeError);
  });
});

describe("holidays source", () => {
  it("has no node: import (client-safe)", () => {
    const source = readFileSync(path.join(__dirname, "holidays.ts"), "utf8");
    expect(source).not.toContain("node:");
  });
});
