// Flowko U29b: the content-hash versions of a member's roster (S2). A save sends back the version it read; the
// server recomputes it from the stored data after the locks and refuses a mismatch (roster_changed), so nothing
// is overwritten silently. The hash is over the content, not over timestamps: a deleted row, a changed usual
// week and a lock all change it, absences and holidays do not (they are saved at once). Server only (node:crypto).
import { createHash } from "node:crypto";
import type { ShiftEntry, WeekHours } from "@calcom/lib/flowkoBusiness/roster";
import { WEEKDAYS } from "@calcom/lib/flowkoBusiness/schemas";

type Member = { status: string; usualWeek: WeekHours | null };

const entriesOf = (entries: ShiftEntry[]) => entries.map((e) => ({ from: e.from, to: e.to }));

/** The usual week with its keys in WEEKDAYS order and entries as {from, to}; null when none. */
function canonicalUsualWeek(usualWeek: WeekHours | null) {
  if (usualWeek === null) return null;
  return WEEKDAYS.map((wd) => entriesOf(usualWeek[wd]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** What the usual-week save checks: the status and the usual week (rows are not part of it). */
export function usualVersionOf(m: Member): string {
  return sha256({ s: m.status, u: canonicalUsualWeek(m.usualWeek) });
}

/**
 * What the week save checks: status, usual week and the member's stored rows on the week's seven dates
 * (`[date, shifts]`, any order; sorted here by date).
 */
export function weekVersionOf(m: Member & { rows: Array<[string, ShiftEntry[]]> }): string {
  const rows = [...m.rows]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, shifts]) => [date, entriesOf(shifts)]);
  return sha256({ s: m.status, u: canonicalUsualWeek(m.usualWeek), r: rows });
}
