// Flowko U29b (S13, S15): the Urnik draft. React state only (D7: no device draft, no web storage). The draft holds
// the roster.week answer it started from (`snapshot`, versions included) and the changed cells, keyed
// `memberId:date` in „Ta teden“ (week mode) or `memberId:weekday` in „Običajni teden“ (usual mode). A cell set back
// to its snapshot value is no change any more; with no change left the snapshot goes too, so the next edit starts
// from the newest answer. The state belongs to one weekStart + mode: another week or mode starts empty (a date
// inside the same week, a phone day arrow or a resize keep it). `weekRows()` / `usualRows()` build the full rows
// the saves send (S14); `copyPreviousWeek` fills the draft from the week before (S15, client only).
import { useCallback, useMemo, useState } from "react";

import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";
import { type ShiftEntry, type WeekHours, type WeekPlan, weekdayOf } from "@calcom/lib/flowkoBusiness/roster";
import { WEEKDAYS, type Weekday } from "@calcom/lib/flowkoBusiness/schemas";

/** Week mode: null = „Običajno“ (follows the usual week), [] = „Prosto“. Usual mode: never null. */
export type DraftCell = ShiftEntry[] | null;
export type RosterMode = "week" | "usual";

type DraftState = {
  /** weekStart + mode the state belongs to. */
  scope: string;
  snapshot: RosterWeekView | null;
  cells: Record<string, DraftCell>;
  // Flowko U29c (P7): bumped by every reset and every discard. A callback works only on the generation it was made
  // in, so a save or copy still running after A → Dan → A (the same scope value again) cannot touch the new draft.
  gen: number;
};

const cellKey = (memberId: number, key: string) => `${memberId}:${key}`;

function sameCell(a: DraftCell, b: DraftCell): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((entry, i) => entry.from === b[i].from && entry.to === b[i].to);
}

const copyCell = (value: DraftCell): DraftCell => (value === null ? null : value.map((e) => ({ ...e })));

/**
 * The stored value of one cell in a roster answer: week mode (`key` = date) the planned entries, else null (the
 * day follows the usual week or has none); usual mode (`key` = weekday) the usual week's entries, [] without one.
 */
export function storedCell(view: RosterWeekView, memberId: number, key: string, mode: RosterMode): DraftCell {
  const member = view.members.find((m) => m.memberId === memberId);
  if (mode === "usual") return member?.usualWeek?.[key as Weekday] ?? [];
  const day = member?.days.find((d) => d.date === key);
  return day?.source === "planned" ? day.entries : null;
}

/** Applies one cell to the state: stored as a change, or dropped when equal to the snapshot's value. */
function withCell(
  state: DraftState,
  base: RosterWeekView,
  mode: RosterMode,
  memberId: number,
  key: string,
  value: DraftCell
): DraftState {
  const snapshot = state.snapshot ?? base;
  const cells = { ...state.cells };
  const id = cellKey(memberId, key);
  const stored = storedCell(snapshot, memberId, key, mode);
  const next = mode === "usual" && value === null ? [] : value;
  if (sameCell(next, stored)) delete cells[id];
  else cells[id] = copyCell(next);
  return { ...state, snapshot: Object.keys(cells).length > 0 ? snapshot : null, cells };
}

export function useRosterDraft(weekStart: string, mode: RosterMode) {
  const scope = `${weekStart}|${mode}`;
  const [raw, setRaw] = useState<DraftState>({ scope, snapshot: null, cells: {}, gen: 0 });
  // Another week or mode: the old state is dropped for good (React's „state from props“ pattern: set during
  // render, no effect, no stale frame), so coming back to the week never revives it.
  // Flowko U29c (P7): the reset starts a new generation.
  if (raw.scope !== scope) setRaw({ scope, snapshot: null, cells: {}, gen: raw.gen + 1 });
  const state = useMemo<DraftState>(
    () => (raw.scope === scope ? raw : { scope, snapshot: null, cells: {}, gen: raw.gen + 1 }),
    [raw, scope]
  );
  const gen = raw.gen;
  // Flowko U29b (Task 8 fix 1): a change belongs to the week + mode its callback was made for. A save or copy that
  // finishes after the user moved on calls the old callbacks; they find another scope in the state and do nothing,
  // so a newer week's edits are never wiped or filled by an older week's async flow (D7).
  // Flowko U29c (P7): and to its generation: the scope is a value, and coming back to the same week gives the same
  // value, so the scope alone cannot tell the draft a save started from the one the user came back to. Accepted side
  // effect: a callback taken before a discard (an open cell sheet's `set`) does nothing after it.
  const update = useCallback(
    (change: (current: DraftState) => DraftState) =>
      setRaw((prev) => (prev.scope === scope && prev.gen === gen ? change(prev) : prev)),
    [scope, gen]
  );

  const { snapshot, cells } = state;
  const changedCount = Object.keys(cells).length;

  const isChanged = useCallback((memberId: number, key: string) => cellKey(memberId, key) in cells, [cells]);

  /** The cell's value in snapshot + draft; with no snapshot (a clean draft) null — read the live answer then. */
  const cell = useCallback(
    (memberId: number, key: string): DraftCell => {
      const id = cellKey(memberId, key);
      if (id in cells) return cells[id];
      return snapshot ? storedCell(snapshot, memberId, key, mode) : null;
    },
    [cells, snapshot, mode]
  );

  const set = useCallback(
    (base: RosterWeekView, memberId: number, key: string, value: DraftCell) =>
      update((current) => withCell(current, base, mode, memberId, key, value)),
    [update, mode]
  );

  const copyPreviousWeek = useCallback(
    (base: RosterWeekView, previous: RosterWeekView, memberIds: number[]) => {
      if (mode !== "week") return;
      update((current) => {
        const from = current.snapshot ?? base;
        let next = current;
        for (const memberId of memberIds) {
          const member = from.members.find((m) => m.memberId === memberId);
          // S15: copy targets are editable rows; a LOCKED member never.
          if (!member || member.status === "LOCKED" || !from.editableMemberIds.includes(memberId)) continue;
          const before = previous.members.find((m) => m.memberId === memberId);
          for (const day of member.days) {
            if (day.date < from.today) continue;
            const weekday = weekdayOf(day.date);
            const prevDay = before?.days.find((d) => weekdayOf(d.date) === weekday);
            const value = prevDay?.source === "planned" ? prevDay.entries : null;
            next = withCell(next, from, mode, memberId, day.date, value);
          }
        }
        return next;
      });
    },
    [update, mode]
  );

  // Flowko U29c (P7): a discard starts a new generation (callbacks taken before it do nothing after it).
  const discard = useCallback(
    () => update((current) => ({ scope, snapshot: null, cells: {}, gen: current.gen + 1 })),
    [update, scope]
  );

  /** Members with at least one change, in the snapshot's row order. */
  const changedMembers = useCallback(() => {
    if (!snapshot) return [];
    const ids = new Set(Object.keys(cells).map((id) => Number(id.split(":")[0])));
    return snapshot.members.filter((m) => ids.has(m.memberId));
  }, [snapshot, cells]);

  const weekRows = useCallback((): Array<{ memberId: number; version: string; days: WeekPlan }> => {
    if (mode !== "week" || !snapshot) return [];
    return changedMembers().map((member) => {
      const days = {} as WeekPlan;
      for (const day of snapshot.days) days[weekdayOf(day.date)] = cell(member.memberId, day.date);
      return { memberId: member.memberId, version: member.weekVersion, days };
    });
  }, [mode, snapshot, changedMembers, cell]);

  const usualRows = useCallback((): Array<{
    memberId: number;
    version: string;
    usualWeek: WeekHours | null;
  }> => {
    if (mode !== "usual" || !snapshot) return [];
    return changedMembers().map((member) => {
      const usualWeek = {} as WeekHours;
      for (const weekday of WEEKDAYS) usualWeek[weekday] = cell(member.memberId, weekday) ?? [];
      // S4: a week with no shift on any day is „no usual week“ (one form).
      const empty = WEEKDAYS.every((weekday) => usualWeek[weekday].length === 0);
      return { memberId: member.memberId, version: member.usualVersion, usualWeek: empty ? null : usualWeek };
    });
  }, [mode, snapshot, changedMembers, cell]);

  return {
    snapshot,
    dirty: changedCount > 0,
    changedCount,
    cell,
    isChanged,
    set,
    copyPreviousWeek,
    discard,
    weekRows,
    usualRows,
  };
}

export type RosterDraft = ReturnType<typeof useRosterDraft>;
