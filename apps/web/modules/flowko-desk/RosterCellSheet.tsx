// Flowko U29b (Task 8, S12, D6): the Urnik cell editor, a Sheet for one worker on one day (or, in „Običajni teden“,
// one weekday). Choices „Običajno“ (week mode only: the day follows the usual week, whose entries show read only),
// „Prosto“ (no shift) and „Izmene“ (from–to rows, up to four, „Dodaj izmeno“); the day's opening hours as a hint.
// The rows are validated with shiftDaySchema (the server's own day rule): its first error shows under the rows and
// holds „Uporabi“ back. „Uporabi“ only hands the value to the caller, which writes it into the draft (no server call):
// null = „Običajno“, [] = „Prosto“, else the shifts. `children` is the caller's place for the absence section
// (Task 9), shown in the week mode only.
// Flowko U29e (E10.1): the opening-hours hint passes RAW, as every Flowko interpolation does.
import { type ReactNode, useState } from "react";

import { ROSTER_MAX_SHIFTS_PER_DAY, type ShiftEntry } from "@calcom/lib/flowkoBusiness/roster";
import { shiftDaySchema } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@calcom/ui/components/sheet";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";
import { DayRangesRows } from "@calcom/web/modules/flowko-settings/DayRangesEditor";

import type { DraftCell, RosterMode } from "./useRosterDraft";

/** shiftDaySchema's issue codes with a text (the opening-hours editor's `flowko_settings_field_<code>`). */
const FIELD_CODES = [
  "time_format",
  "start_at_24",
  "before_03_00",
  "end_not_after_start",
  "unsorted_or_overlapping",
];

const DEFAULT_SHIFT: ShiftEntry = { from: "08:00", to: "16:00" };
const copyEntries = (entries: ShiftEntry[]): ShiftEntry[] => entries.map((entry) => ({ ...entry }));

export function RosterCellSheet(props: {
  /** „Ana · torek, 17. 11.“ */
  title: string;
  mode: RosterMode;
  /** The cell's value now: null = „Običajno“ (week mode), [] = „Prosto“. */
  value: DraftCell;
  /** The usual week's entries for this weekday (what „Običajno“ shows). */
  usualEntries: ShiftEntry[];
  /** The day's opening hours (the hint). */
  opening: ShiftEntry[];
  /** The day is a closed holiday: the hint says „Zaprto“. */
  closed: boolean;
  onApply: (value: DraftCell) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const week = props.mode === "week";
  const [usual, setUsual] = useState(week && props.value === null);
  const [ranges, setRanges] = useState<ShiftEntry[]>(
    copyEntries(props.value === null ? props.usualEntries : props.value)
  );

  const parsed = shiftDaySchema.safeParse(ranges);
  const issue = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const error = issue
    ? t(`flowko_settings_field_${FIELD_CODES.includes(issue) ? issue : "invalid"}`)
    : undefined;

  const edit = (next: ShiftEntry[]) => {
    setUsual(false);
    setRanges(next);
  };
  const chooseUsual = () => {
    setUsual(true);
    setRanges(copyEntries(props.usualEntries));
  };
  const chooseOff = () => edit([]);
  const chooseShifts = () => {
    if (!usual && ranges.length > 0) return;
    edit(ranges.length > 0 ? ranges : [{ ...DEFAULT_SHIFT }]);
  };

  const hint =
    props.closed || props.opening.length === 0
      ? t("flowko_settings_closed")
      : t("flowko_roster_opening_hint", {
          hours: props.opening.map((entry) => `${entry.from}–${entry.to}`).join(", "),
          ...RAW,
        });

  const choiceClass = (active: boolean) => (active ? "ring-brand-default ring-2" : "");
  const isOff = !usual && ranges.length === 0;
  const isShifts = !usual && ranges.length > 0;

  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          <p data-testid="roster-sheet-hint" className="text-subtle text-sm">
            {hint}
          </p>
          <div className="flex flex-wrap gap-2">
            {week && (
              <Button
                type="button"
                color="secondary"
                size="sm"
                aria-pressed={usual}
                className={choiceClass(usual)}
                onClick={chooseUsual}>
                {t("flowko_roster_cell_usual")}
              </Button>
            )}
            <Button
              type="button"
              color="secondary"
              size="sm"
              aria-pressed={isOff}
              className={choiceClass(isOff)}
              onClick={chooseOff}>
              {t("flowko_roster_off")}
            </Button>
            <Button
              type="button"
              color="secondary"
              size="sm"
              aria-pressed={isShifts}
              className={choiceClass(isShifts)}
              onClick={chooseShifts}>
              {t("flowko_roster_cell_shifts")}
            </Button>
          </div>
          <DayRangesRows
            value={ranges}
            onChange={edit}
            dayLabel={props.title}
            addLabel={t("flowko_roster_add_shift")}
            addAriaLabel={t("flowko_roster_add_shift")}
            emptyLabel={t("flowko_roster_off")}
            maxRows={ROSTER_MAX_SHIFTS_PER_DAY}
            error={error}
            disabled={usual}
            testIdPrefix="roster-sheet-rows"
          />
          {week && props.children}
        </SheetBody>
        <SheetFooter className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" color="secondary" onClick={props.onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            color="primary"
            data-testid="roster-sheet-apply"
            disabled={error !== undefined}
            onClick={() => props.onApply(usual ? null : copyEntries(ranges))}>
            {t("flowko_roster_cell_apply")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
