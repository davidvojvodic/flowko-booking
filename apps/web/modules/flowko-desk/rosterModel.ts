// Flowko U29b (Task 7, S9, S10, S11): what Urnik shows, computed once per render from the roster answer (the draft's
// snapshot while edits are open, else the live answer) and the draft: the visible rows in order, the day columns,
// and per cell its value, source, markers and whether it is editable. Pure; no hooks.
import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";
import { type ShiftEntry, addDays, weekdayOf } from "@calcom/lib/flowkoBusiness/roster";
import { WEEKDAYS, type Weekday } from "@calcom/lib/flowkoBusiness/schemas";

import type { RosterCellModel } from "./RosterCell";
import type { RosterDraft, RosterMode } from "./useRosterDraft";

export type RosterMember = RosterWeekView["members"][number];

/** Cal's weekday texts („ponedeljek“ …), as the opening-hours editor uses them. */
export const WEEKDAY_TEXT_KEYS: Record<Weekday, string> = {
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
  sun: "sunday",
};

/** „torek, 17. 11.“: a date with the full weekday name (the cell sheet's title, a cell's accessible name). */
export function formatDayLabelLong(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** The day half of a cell's name: the long date (week mode) or the weekday's name („ponedeljek“, usual mode). */
export function cellDayText(input: {
  mode: RosterMode;
  key: string;
  t: (key: string) => string;
  language: string;
}): string {
  return input.mode === "usual"
    ? input.t(WEEKDAY_TEXT_KEYS[input.key as Weekday])
    : formatDayLabelLong(input.key, input.language);
}

/** G7: the last writable date is today + 371 (the owner's holiday menu follows the same window). */
const HORIZON_DAYS = 371;

export type RosterLayout = {
  /** The answer being shown: the draft's snapshot while edits are open, else the live one. */
  view: RosterWeekView;
  mode: RosterMode;
  today: string;
  /** Visible rows (LOCKED hidden; a worker's own row first). */
  members: RosterMember[];
  /** A WORKER's own member id (the pinned, highlighted row); null for the owner and STAFF. */
  ownId: number | null;
  /** The columns: the seven dates (week mode) or weekdays (usual mode). */
  keys: string[];
  cellOf: (memberId: number, key: string) => RosterCellModel;
  /** The column of a closed holiday (week mode only). */
  isClosed: (key: string) => boolean;
  /** The owner may open/close this holiday (S8: week mode, today…today+371, writable week). */
  canManageHoliday: (date: string) => boolean;
  dirty: boolean;
};

const sameEntries = (a: ShiftEntry[], b: ShiftEntry[]) =>
  a.length === b.length && a.every((entry, i) => entry.from === b[i].from && entry.to === b[i].to);

export function buildRosterLayout(input: {
  view: RosterWeekView;
  mode: RosterMode;
  draft: RosterDraft;
  today: string;
  ownId: number | null;
}): RosterLayout {
  const { view, mode, draft, today } = input;
  const visible = view.members.filter((m) => m.status !== "LOCKED");
  const own = input.ownId === null ? undefined : visible.find((m) => m.memberId === input.ownId);
  const members = own ? [own, ...visible.filter((m) => m !== own)] : visible;
  const weekWritable = view.weekStart <= view.lastWritableWeekStart;
  const editableIds = new Set(view.editableMemberIds);

  const cellOf = (memberId: number, key: string): RosterCellModel => {
    const member = view.members.find((m) => m.memberId === memberId);
    const changed = draft.isChanged(memberId, key);
    if (mode === "usual") {
      const stored = member?.usualWeek?.[key as Weekday] ?? [];
      return {
        memberId,
        key,
        entries: changed ? (draft.cell(memberId, key) ?? []) : stored,
        source: changed ? "draft" : member?.usualWeek ? "usual" : "none",
        absent: false,
        differsFromUsual: false,
        changed,
        editable: view.canEditUsualWeek && editableIds.has(memberId),
      };
    }
    const usualEntries = member?.usualWeek?.[weekdayOf(key)] ?? [];
    const day = member?.days.find((d) => d.date === key);
    const value = changed ? draft.cell(memberId, key) : null;
    // A draft value null = „Običajno“: the day falls back to the usual week again, still shown as changed.
    const fallback = member?.usualWeek ? "usual" : "none";
    const entries = changed ? (value ?? usualEntries) : (day?.entries ?? []);
    const source = changed ? (value === null ? fallback : "draft") : (day?.source ?? "none");
    const absent = day?.absent ?? false;
    return {
      memberId,
      key,
      entries,
      source,
      absent,
      differsFromUsual:
        !absent && (source === "planned" || source === "draft") && !sameEntries(entries, usualEntries),
      changed,
      editable: weekWritable && editableIds.has(memberId) && key >= today,
    };
  };

  const closedDates = new Set(view.days.filter((d) => d.holiday && !d.holiday.open).map((d) => d.date));
  return {
    view,
    mode,
    today,
    members,
    ownId: own ? own.memberId : null,
    keys: mode === "usual" ? Array.from(WEEKDAYS) : view.days.map((d) => d.date),
    cellOf,
    isClosed: (key) => mode === "week" && closedDates.has(key),
    canManageHoliday: (date) =>
      mode === "week" &&
      view.canEditUsualWeek &&
      weekWritable &&
      date >= today &&
      date <= addDays(today, HORIZON_DAYS),
    dirty: draft.dirty,
  };
}
