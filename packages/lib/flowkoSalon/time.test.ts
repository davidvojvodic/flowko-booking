// Flowko U24: tests for wall-clock conversion and the day grid (Europe/Ljubljana DST). Run with TZ=UTC.
import { describe, expect, it } from "vitest";

import { dayBounds, gridStarts, localInterval, wallClockToMs } from "./time";

const TZ = "Europe/Ljubljana";
const HOUR = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();

describe("Flowko U24: time", () => {
  it("wallClockToMs is correct across DST changes", () => {
    expect(iso(wallClockToMs("2026-03-28", "09:00", TZ))).toBe("2026-03-28T08:00:00.000Z");
    expect(iso(wallClockToMs("2026-03-29", "09:00", TZ))).toBe("2026-03-29T07:00:00.000Z");
    expect(iso(wallClockToMs("2026-10-25", "09:00", TZ))).toBe("2026-10-25T08:00:00.000Z");
  });

  it("localInterval keeps wall-clock length on DST days after 07:00", () => {
    for (const d of ["2026-03-29", "2026-10-25"]) {
      const i = localInterval(d, "07:00", "20:00", TZ);
      expect(i.end - i.start).toBe(13 * HOUR);
    }
  });

  it("localInterval throws RangeError when to <= from", () => {
    expect(() => localInterval("2026-11-10", "10:00", "10:00", TZ)).toThrow(RangeError);
    expect(() => localInterval("2026-11-10", "11:00", "10:00", TZ)).toThrow(RangeError);
  });

  it("dayBounds is 23 h, 25 h and 24 h on spring, autumn and normal days", () => {
    const len = (d: string) => {
      const b = dayBounds(d, TZ);
      return (b.end - b.start) / HOUR;
    };
    expect(len("2026-03-29")).toBe(23);
    expect(len("2026-10-25")).toBe(25);
    expect(len("2026-11-10")).toBe(24);
  });

  it("gridStarts yields day.start + k*step below day.end", () => {
    const day = localInterval("2026-11-10", "07:00", "08:00", TZ);
    const starts = gridStarts(day, 15);
    expect(starts).toHaveLength(4);
    expect(starts[0]).toBe(wallClockToMs("2026-11-10", "07:00", TZ));
    expect(starts[3]).toBe(day.start + 45 * 60_000);
  });

  it("24:00 equals next day 00:00", () => {
    expect(wallClockToMs("2026-11-10", "24:00", TZ)).toBe(wallClockToMs("2026-11-11", "00:00", TZ));
    expect(wallClockToMs("2026-12-31", "24:00", TZ)).toBe(wallClockToMs("2027-01-01", "00:00", TZ));
  });

  it("throws RangeError on bad step or malformed input", () => {
    const day = dayBounds("2026-11-10", TZ);
    expect(() => gridStarts(day, 7)).toThrow(RangeError);
    expect(() => gridStarts(day, 0)).toThrow(RangeError);
    expect(() => wallClockToMs("2026-13-01", "09:00", TZ)).toThrow(RangeError);
    expect(() => wallClockToMs("2026-02-30", "09:00", TZ)).toThrow(RangeError);
    expect(() => wallClockToMs("2026-11-10", "25:00", TZ)).toThrow(RangeError);
    expect(() => wallClockToMs("2026-11-10", "9:00", TZ)).toThrow(RangeError);
    expect(() => wallClockToMs("2026-11-10", "09:60", TZ)).toThrow(RangeError);
    expect(() => wallClockToMs("26-11-10", "09:00", TZ)).toThrow(RangeError);
  });
});
