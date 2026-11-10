// Flowko U29b (S13, S15): the Urnik draft: changed cells against the snapshot the draft started from, full rows
// with the snapshot's versions for the saves, „Kopiraj prejšnji teden“ into the draft, and the reset per week and
// mode (a date inside the same week keeps the draft).
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mondayOf } from "./WeekGrid";
import {
  ANA,
  BOR,
  CENE,
  DAN,
  OLGA,
  rosterMember,
  rosterWeek,
  usualVersionOf,
  weekVersionOf,
} from "./desk.fixture";
import { useRosterDraft } from "./useRosterDraft";

const s = (from: string, to: string) => ({ from, to });
const EIGHT_TO_FOUR = [s("08:00", "16:00")];

function weekDraft() {
  return renderHook(({ weekStart, mode }) => useRosterDraft(weekStart, mode), {
    initialProps: { weekStart: "2026-11-16", mode: "week" as "week" | "usual" },
  });
}

describe("useRosterDraft (U29b S13)", () => {
  it("starts clean: no snapshot, nothing changed, no rows", () => {
    const { result } = weekDraft();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.changedCount).toBe(0);
    expect(result.current.weekRows()).toEqual([]);
    expect(result.current.usualRows()).toEqual([]);
  });

  it("a change counts and highlights; setting it back to the snapshot value drops it (and the snapshot)", () => {
    const base = rosterWeek();
    const { result } = weekDraft();
    act(() => result.current.set(base, ANA, "2026-11-17", [s("10:00", "14:00")]));
    expect(result.current.dirty).toBe(true);
    expect(result.current.changedCount).toBe(1);
    expect(result.current.isChanged(ANA, "2026-11-17")).toBe(true);
    expect(result.current.cell(ANA, "2026-11-17")).toEqual([s("10:00", "14:00")]);
    expect(result.current.snapshot).toBe(base);

    // Ana's Tuesday follows her usual week (null); back to „Običajno“ is the stored value again
    act(() => result.current.set(base, ANA, "2026-11-17", null));
    expect(result.current.changedCount).toBe(0);
    expect(result.current.isChanged(ANA, "2026-11-17")).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.snapshot).toBeNull();
  });

  it("compares by value: a planned day set to an equal copy of its entries is no change", () => {
    const base = rosterWeek();
    const { result } = weekDraft();
    act(() => result.current.set(base, BOR, "2026-11-19", [s("10:00", "14:00")]));
    act(() => result.current.set(base, BOR, "2026-11-18", []));
    expect(result.current.changedCount).toBe(0);
    // „Običajno“ on a planned day off is a change
    act(() => result.current.set(base, BOR, "2026-11-18", null));
    expect(result.current.isChanged(BOR, "2026-11-18")).toBe(true);
  });

  it("cell(): the draft value where changed, else the snapshot's stored value (planned entries, else null)", () => {
    const base = rosterWeek();
    const { result } = weekDraft();
    act(() => result.current.set(base, ANA, "2026-11-17", []));
    expect(result.current.cell(ANA, "2026-11-17")).toEqual([]);
    expect(result.current.cell(ANA, "2026-11-16")).toBeNull();
    expect(result.current.cell(BOR, "2026-11-18")).toEqual([]);
    expect(result.current.cell(BOR, "2026-11-19")).toEqual([s("10:00", "14:00")]);
  });

  it("weekRows(): only changed members, full 7-day plans, the snapshot's version", () => {
    const base = rosterWeek();
    const { result } = weekDraft();
    act(() => result.current.set(base, BOR, "2026-11-16", []));
    act(() => result.current.set(base, ANA, "2026-11-17", [s("10:00", "14:00")]));
    act(() => result.current.set(base, ANA, "2026-11-21", [s("08:00", "12:00")]));
    expect(result.current.changedCount).toBe(3);
    expect(result.current.weekRows()).toEqual([
      {
        memberId: ANA,
        version: weekVersionOf(ANA),
        days: {
          mon: null,
          tue: [s("10:00", "14:00")],
          wed: null,
          thu: null,
          fri: null,
          sat: [s("08:00", "12:00")],
          sun: null,
        },
      },
      {
        memberId: BOR,
        version: weekVersionOf(BOR),
        // Bor's stored planned days ride along unchanged
        days: { mon: [], tue: null, wed: [], thu: [s("10:00", "14:00")], fri: null, sat: null, sun: null },
      },
    ]);
    expect(result.current.usualRows()).toEqual([]);
  });

  it("keeps the snapshot it started from: a newer answer passed later does not change the versions", () => {
    const first = rosterWeek();
    const newer = rosterWeek({
      members: first.members.map((m) => ({ ...m, weekVersion: "c".repeat(64) })),
    });
    const { result } = weekDraft();
    act(() => result.current.set(first, ANA, "2026-11-17", []));
    act(() => result.current.set(newer, BOR, "2026-11-17", []));
    expect(result.current.snapshot).toBe(first);
    expect(result.current.weekRows().map((r) => r.version)).toEqual([weekVersionOf(ANA), weekVersionOf(BOR)]);
  });

  it("discard() empties the draft", () => {
    const base = rosterWeek();
    const { result } = weekDraft();
    act(() => result.current.set(base, ANA, "2026-11-17", []));
    act(() => result.current.discard());
    expect(result.current.dirty).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.weekRows()).toEqual([]);
  });

  it("usual mode: cells keyed by weekday, never null; usualRows() sends full weeks with the usual version", () => {
    const base = rosterWeek();
    const { result } = renderHook(() => useRosterDraft("2026-11-16", "usual"));
    expect(result.current.cell(CENE, "mon")).toBeNull(); // clean: no snapshot yet
    act(() => result.current.set(base, ANA, "mon", [s("09:00", "15:00")]));
    expect(result.current.cell(ANA, "tue")).toEqual(EIGHT_TO_FOUR);
    expect(result.current.cell(CENE, "mon")).toEqual([]);
    act(() => result.current.set(base, CENE, "sat", [s("08:00", "12:00")]));
    expect(result.current.usualRows()).toEqual([
      {
        memberId: ANA,
        version: usualVersionOf(ANA),
        usualWeek: {
          mon: [s("09:00", "15:00")],
          tue: EIGHT_TO_FOUR,
          wed: EIGHT_TO_FOUR,
          thu: EIGHT_TO_FOUR,
          fri: EIGHT_TO_FOUR,
          sat: [s("08:00", "13:00")],
          sun: [],
        },
      },
      {
        memberId: CENE,
        version: usualVersionOf(CENE),
        usualWeek: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [s("08:00", "12:00")], sun: [] },
      },
    ]);
    expect(result.current.weekRows()).toEqual([]);
    // back to the stored empty day: Cene unchanged again
    act(() => result.current.set(base, CENE, "sat", []));
    expect(result.current.usualRows().map((r) => r.memberId)).toEqual([ANA]);
  });

  it("usual mode: a week emptied on every day is sent as null (one form for „no usual week“)", () => {
    const base = rosterWeek();
    const { result } = renderHook(() => useRosterDraft("2026-11-16", "usual"));
    act(() => {
      for (const day of ["mon", "tue", "wed", "thu", "fri"]) result.current.set(base, OLGA, day, []);
    });
    expect(result.current.changedCount).toBe(5);
    expect(result.current.usualRows()).toEqual([
      { memberId: OLGA, version: usualVersionOf(OLGA), usualWeek: null },
    ]);
  });

  it("a new weekStart or mode resets the draft; a new date inside the same week does not", () => {
    const base = rosterWeek();
    const { result, rerender } = renderHook(
      ({ date, mode }: { date: string; mode: "week" | "usual" }) => useRosterDraft(mondayOf(date), mode),
      { initialProps: { date: "2026-11-16", mode: "week" as "week" | "usual" } }
    );
    act(() => result.current.set(base, ANA, "2026-11-17", []));
    rerender({ date: "2026-11-19", mode: "week" });
    expect(result.current.dirty).toBe(true);
    rerender({ date: "2026-11-22", mode: "week" });
    expect(result.current.dirty).toBe(true);
    rerender({ date: "2026-11-23", mode: "week" });
    expect(result.current.dirty).toBe(false);
    expect(result.current.snapshot).toBeNull();
    // and back: the old week's edits are gone for good
    rerender({ date: "2026-11-16", mode: "week" });
    expect(result.current.dirty).toBe(false);

    act(() => result.current.set(base, ANA, "2026-11-17", []));
    rerender({ date: "2026-11-16", mode: "usual" });
    expect(result.current.dirty).toBe(false);
    expect(result.current.cell(ANA, "tue")).toBeNull();
  });
});

describe("useRosterDraft copyPreviousWeek (U29b S15)", () => {
  // Today is Wednesday the 18th: Monday 16th and Tuesday 17th are past and never touched.
  const base = rosterWeek({ today: "2026-11-18" });
  const usualOf = (memberId: number) => base.members.find((m) => m.memberId === memberId)?.usualWeek ?? null;
  const previous = rosterWeek({
    weekStart: "2026-11-09",
    members: [
      rosterMember(
        OLGA,
        "Olga",
        { usualWeek: usualOf(OLGA), planned: { "2026-11-11": [s("07:00", "11:00")] } },
        "2026-11-09"
      ),
      rosterMember(
        ANA,
        "Ana",
        {
          usualWeek: usualOf(ANA),
          planned: { "2026-11-09": [s("10:00", "12:00")], "2026-11-12": [] },
          absences: [{ id: 70, startDate: "2026-11-13", endDate: "2026-11-14" }],
        },
        "2026-11-09"
      ),
      rosterMember(
        BOR,
        "Bor",
        {
          usualWeek: usualOf(BOR),
          absences: [{ id: 69, startDate: "2026-11-13", endDate: "2026-11-13" }],
        },
        "2026-11-09"
      ),
      rosterMember(CENE, "Cene", { usualWeek: null, deskOnly: true }, "2026-11-09"),
      rosterMember(
        DAN,
        "Dan",
        { usualWeek: usualOf(DAN), status: "LOCKED", planned: { "2026-11-19": [], "2026-11-12": [] } },
        "2026-11-09"
      ),
    ],
  });

  it("planned → entries, usual/none → null, dates before today untouched, LOCKED never, absences not copied", () => {
    const { result } = weekDraft();
    // existing draft cells of the copied rows are replaced
    act(() => result.current.set(base, ANA, "2026-11-19", [s("13:00", "17:00")]));
    act(() => result.current.set(base, ANA, "2026-11-18", [s("09:00", "10:00")]));
    act(() => result.current.copyPreviousWeek(base, previous, [OLGA, ANA, BOR, CENE, DAN]));

    // Olga: Wed 11 was planned → Wed 18 gets it
    expect(result.current.cell(OLGA, "2026-11-18")).toEqual([s("07:00", "11:00")]);
    // Ana: Mon 9 planned, but Mon 16 is before today → untouched
    expect(result.current.isChanged(ANA, "2026-11-16")).toBe(false);
    expect(result.current.cell(ANA, "2026-11-16")).toBeNull();
    // Ana: Thu 12 planned day off → Thu 19 „Prosto“ (replaces the draft's 13–17)
    expect(result.current.cell(ANA, "2026-11-19")).toEqual([]);
    // Ana: Wed 11 followed the usual week → Wed 18 null = stored → the draft's 09–10 is gone, no change
    expect(result.current.isChanged(ANA, "2026-11-18")).toBe(false);
    // Ana's absence (Fri 13–Sat 14) is not copied: Fri 20 / Sat 21 stay as stored
    expect(result.current.isChanged(ANA, "2026-11-20")).toBe(false);
    expect(result.current.isChanged(ANA, "2026-11-21")).toBe(false);
    // Bor: his planned Wed 18 off and Thu 19 10–14 go back to the usual week (the previous week had none)
    expect(result.current.cell(BOR, "2026-11-18")).toBeNull();
    expect(result.current.cell(BOR, "2026-11-19")).toBeNull();
    expect(result.current.isChanged(BOR, "2026-11-20")).toBe(false);
    // Dan is LOCKED: never a target
    expect(result.current.isChanged(DAN, "2026-11-19")).toBe(false);
    // Cene had nothing planned either week: no change
    expect(result.current.weekRows().map((r) => r.memberId)).toEqual([OLGA, ANA, BOR]);
    expect(result.current.changedCount).toBe(4);
  });

  it("copies only the given members (a worker's own row) and only editable ones", () => {
    const { result } = weekDraft();
    act(() => result.current.copyPreviousWeek(base, previous, [ANA]));
    expect(result.current.weekRows().map((r) => r.memberId)).toEqual([ANA]);
    act(() => result.current.discard());
    const workerView = rosterWeek({ today: "2026-11-18", editableMemberIds: [ANA] });
    act(() => result.current.copyPreviousWeek(workerView, previous, [OLGA, ANA]));
    expect(result.current.weekRows().map((r) => r.memberId)).toEqual([ANA]);
  });

  it("does nothing in usual mode", () => {
    const { result } = renderHook(() => useRosterDraft("2026-11-16", "usual"));
    act(() => result.current.copyPreviousWeek(base, previous, [OLGA, ANA, BOR]));
    expect(result.current.dirty).toBe(false);
  });
});
