// Flowko U29b (Task 7, S10, S11, S13): one cell of Urnik (a worker on a day, or in „Običajni teden“ on a weekday).
// Shifts one per line („08:00–16:00“), „Prosto“ for no shift, „Odsotnost“ with the desk's hatch for an absence,
// entries that come from the usual week in muted text, a dot for a day that differs from the usual week, the ring
// of a changed (draft) cell, `bg-muted` in the column of a closed holiday. A button only when the cell is editable
// and the caller handles the tap (the cell editor, Task 8; `label` names it: worker, day, value); the cell never decides what is editable.
import type { ShiftEntry } from "@calcom/lib/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { HATCH } from "./WorkerColumn";

export type RosterCellModel = {
  memberId: number;
  /** Week mode: the date ("YYYY-MM-DD"); usual mode: the weekday ("mon" …). */
  key: string;
  entries: ShiftEntry[];
  source: "planned" | "usual" | "none" | "draft";
  absent: boolean;
  /** Week mode: the day's entries differ from the usual weekday's (a planned or draft day only). */
  differsFromUsual: boolean;
  /** The draft holds a value for this cell. */
  changed: boolean;
  editable: boolean;
};

export function RosterCell(props: {
  model: RosterCellModel;
  /** The column of a closed holiday. */
  closed: boolean;
  /** Tap on an editable cell. */
  onSelect?: (model: RosterCellModel) => void;
  /** Who and which day („Ana, torek, 17. 11.“): a tappable cell's accessible name is this plus its value. */
  label?: string;
}) {
  const { t } = useLocale();
  const { model } = props;
  const tappable = model.editable && props.onSelect !== undefined;
  // Entries of the usual week (and "none") are what the day falls back to: muted; planned and draft ones are not.
  const derived = model.source === "usual" || model.source === "none";
  const common = {
    "data-testid": `roster-cell-${model.memberId}-${model.key}`,
    "data-editable": String(model.editable),
    "data-changed": model.changed ? "true" : undefined,
    "data-absent": model.absent ? "true" : undefined,
    "data-source": model.source,
    "data-pattern": model.absent ? "hatched" : undefined,
    style: model.absent ? { backgroundImage: HATCH } : undefined,
    className: classNames(
      "border-subtle relative flex min-h-12 w-full min-w-0 flex-col justify-center gap-0.5 border-b border-l px-2 py-1.5 text-left text-sm",
      props.closed ? "bg-muted" : model.absent ? "bg-subtle" : "bg-default",
      model.changed && "ring-brand-default ring-2 ring-inset",
      tappable && "hover:bg-subtle focus-visible:ring-brand-default cursor-pointer focus-visible:ring-2"
    ),
  };
  const summary = model.absent
    ? t("flowko_desk_time_off")
    : model.entries.length === 0
      ? t("flowko_roster_off")
      : model.entries.map((entry) => `${entry.from}–${entry.to}`).join(", ");
  // Flowko U29b final review (UI-4): the accessible name replaces the content for assistive technology, so it states the
  // state too: unsaved (draft), differs from the usual week (the dot's text), or follows the usual week.
  const state = model.changed
    ? t("flowko_roster_cell_changed")
    : model.differsFromUsual
      ? t("flowko_roster_differs_usual")
      : model.source === "usual"
        ? t("flowko_roster_cell_usual")
        : null;
  const accessibleName = props.label
    ? `${props.label}: ${summary}${state ? `, ${state}` : ""}${
        model.changed && model.differsFromUsual ? `, ${t("flowko_roster_differs_usual")}` : ""
      }`
    : undefined;
  const content = (
    <>
      {model.absent ? (
        <span className="text-subtle text-xs">{t("flowko_desk_time_off")}</span>
      ) : model.entries.length === 0 ? (
        <span data-testid="roster-cell-off" className={derived ? "text-subtle" : "text-emphasis"}>
          {t("flowko_roster_off")}
        </span>
      ) : (
        model.entries.map((entry) => (
          <span
            key={`${entry.from}-${entry.to}`}
            data-testid="roster-cell-shift"
            className={classNames("whitespace-nowrap", derived ? "text-subtle" : "text-emphasis")}>
            {`${entry.from}–${entry.to}`}
          </span>
        ))
      )}
      {model.differsFromUsual && (
        <span
          role="img"
          data-testid="roster-differs"
          aria-label={t("flowko_roster_differs_usual")}
          className="bg-attention absolute right-1 top-1 h-2 w-2 rounded-full"
        />
      )}
    </>
  );
  return tappable ? (
    <button
      type="button"
      {...common}
      // Flowko U29b (Task 8): the visible value alone does not say whose day it is.
      aria-label={accessibleName}
      onClick={() => props.onSelect?.(model)}>
      {content}
    </button>
  ) : (
    // Flowko U29b final review (UI-4): a read-only cell also names its worker and day (a labelled group; no table roles).
    <div {...common} role={accessibleName ? "group" : undefined} aria-label={accessibleName}>
      {content}
    </div>
  );
}
