// Flowko U29b: the content-hash versions of a member's roster (S2): 64 hex chars, independent of key and row
// order, changed by a removed row, a changed usual week and a changed status; `usualVersionOf` ignores rows.
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { describe, expect, it } from "vitest";
import { usualVersionOf, weekVersionOf } from "./rosterVersion";

const S = (from: string, to: string): ShiftEntry => ({ from, to });
const USUAL: WeekHours = {
  mon: [S("08:00", "16:00")],
  tue: [S("08:00", "16:00")],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
const ROWS: Array<[string, ShiftEntry[]]> = [
  ["2026-11-16", [S("09:00", "12:00"), S("13:00", "17:00")]],
  ["2026-11-18", []],
];
const base = { status: "ACTIVE", usualWeek: USUAL, rows: ROWS };

describe("weekVersionOf / usualVersionOf", () => {
  it("are 64 hex characters", () => {
    expect(weekVersionOf(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(usualVersionOf(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(weekVersionOf({ status: "ACTIVE", usualWeek: null, rows: [] })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("equal content gives an equal hash, whatever the key order of the usual week or the row order", () => {
    const shuffled: WeekHours = {
      sun: [],
      sat: [],
      fri: [],
      thu: [],
      wed: [],
      tue: [{ to: "16:00", from: "08:00" }],
      mon: [{ to: "16:00", from: "08:00" }],
    };
    const reversed = [...ROWS].reverse();
    expect(weekVersionOf({ status: "ACTIVE", usualWeek: shuffled, rows: reversed })).toBe(weekVersionOf(base));
    expect(usualVersionOf({ status: "ACTIVE", usualWeek: shuffled })).toBe(usualVersionOf(base));
  });

  it("a removed row, a changed shift, a changed usual week and a changed status each change weekVersion", () => {
    const v = weekVersionOf(base);
    expect(weekVersionOf({ ...base, rows: ROWS.slice(0, 1) })).not.toBe(v);
    expect(weekVersionOf({ ...base, rows: [ROWS[0], ["2026-11-18", [S("08:00", "10:00")]]] })).not.toBe(v);
    expect(weekVersionOf({ ...base, usualWeek: { ...USUAL, wed: [S("08:00", "12:00")] } })).not.toBe(v);
    expect(weekVersionOf({ ...base, usualWeek: null })).not.toBe(v);
    expect(weekVersionOf({ ...base, status: "LOCKED" })).not.toBe(v);
  });

  it("a row moved to another date changes weekVersion", () => {
    expect(weekVersionOf({ ...base, rows: [["2026-11-17", ROWS[0][1]], ROWS[1]] })).not.toBe(
      weekVersionOf(base)
    );
  });

  it("usualVersionOf ignores rows but follows the usual week and the status", () => {
    const v = usualVersionOf(base);
    expect(usualVersionOf({ status: "ACTIVE", usualWeek: USUAL })).toBe(v);
    expect(usualVersionOf({ status: "LOCKED", usualWeek: USUAL })).not.toBe(v);
    expect(usualVersionOf({ status: "ACTIVE", usualWeek: { ...USUAL, mon: [] } })).not.toBe(v);
    expect(usualVersionOf({ status: "ACTIVE", usualWeek: null })).not.toBe(v);
  });

  it("the week hash and the usual hash of one member differ", () => {
    expect(weekVersionOf({ ...base, rows: [] })).not.toBe(usualVersionOf(base));
  });
});
