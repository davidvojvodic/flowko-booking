// Flowko U28: the date bar of the desk and its URL state (?date=&view=&worker=). `date` is a business-local
// "YYYY-MM-DD"; no or a malformed date means today in the business time zone (decided by the caller from the
// server's clock). Previous/next step by calendar days (DST-safe, roster `addDays`), by seven in the week view.
// The week toggle is disabled with a hint where the week view is not offered (a phone, D2).
// Flowko U29b (S1): a third view „Urnik“ (?view=roster) on every size, and ?rosterMode=week|usual. In Urnik the
// arrows step a week with the week label from md up and a day with the day label on a phone; in the usual week
// (no dates) the arrows, the date picker and „Danes“ are hidden and only the view toggle stays.
// Flowko U29f (F1, R2–R7): the date picker's popover speaks the desk's language (date-fns sl / en-US), starts
// weeks on Monday, marks the business today, hides outside days and labels its arrows; the selected day's
// brand colour is the Calendar default since U29f Task 1.
import type { Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { sl } from "date-fns/locale/sl";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";

import { addDays, localDateSchema } from "@calcom/lib/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { DatePicker, ToggleGroup } from "@calcom/ui/components/form";

import { mondayOf } from "./WeekGrid";

// Flowko U29b (S1): "roster" = „Urnik“.
export const DESK_VIEWS = ["day", "week", "roster"] as const;
export type DeskViewKind = (typeof DESK_VIEWS)[number];
/** Flowko U29b (S1, D5): Urnik's „Ta teden“ / „Običajni teden“. */
export const ROSTER_MODES = ["week", "usual"] as const;
export type RosterModeKind = (typeof ROSTER_MODES)[number];

export function useDeskParams() {
  const [rawDate, setRawDate] = useQueryState("date", parseAsString);
  const [view, setView] = useQueryState("view", parseAsStringLiteral(DESK_VIEWS).withDefault("day"));
  const [worker, setWorker] = useQueryState("worker", parseAsInteger);
  // Flowko U29b (S1): an unknown value falls back to "week" (as `view` falls back to "day").
  const [rosterMode, setRosterMode] = useQueryState(
    "rosterMode",
    parseAsStringLiteral(ROSTER_MODES).withDefault("week")
  );
  const date = rawDate !== null && localDateSchema.safeParse(rawDate).success ? rawDate : null;
  return {
    state: { date, view, worker, rosterMode },
    /** null = today (drops the parameter). */
    setDate: (next: string | null) => void setRawDate(next),
    setView: (next: DeskViewKind) => void setView(next),
    setWorker: (next: number | null) => void setWorker(next),
    setRosterMode: (next: RosterModeKind) => void setRosterMode(next),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar shows the browser's local midnight of the business date; a picked day maps back by its fields. */
const toPickerDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fromPickerDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Flowko U29f (R2): the picker's date-fns locale, from the same language (and fallback) as the button label. */
export function deskPickerLocale(language: string | undefined): Locale {
  return (language ?? "sl").startsWith("sl") ? sl : enUS;
}

function formatDateLabel(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "ponedeljek, 16. november 2026" or, in the week view, "16. november – 22. november 2026". */
function formatWeekLabel(date: string, language: string): string {
  const monday = mondayOf(date);
  const format = (d: string, withYear: boolean) =>
    new Intl.DateTimeFormat(language, {
      day: "numeric",
      month: "long",
      ...(withYear && { year: "numeric" }),
      timeZone: "UTC",
    }).format(new Date(`${d}T12:00:00Z`));
  return `${format(monday, false)} – ${format(addDays(monday, 6), true)}`;
}

export function DateBar(props: {
  date: string;
  today: string;
  view: DeskViewKind;
  /** Flowko U28 (D2): false on a phone: the week toggle is disabled and a hint says why. Default true. */
  weekAvailable?: boolean;
  /** Flowko U29b (S1): Urnik's mode; "usual" (no dates) hides the arrows, the date picker and „Danes“. */
  rosterMode?: RosterModeKind;
  onDateChange: (date: string | null) => void;
  onViewChange: (view: DeskViewKind) => void;
}) {
  const { t, i18n } = useLocale();
  const { date, today, onDateChange } = props;
  const go = (next: string) => onDateChange(next === today ? null : next);
  const weekAvailable = props.weekAvailable ?? true;
  // Flowko U29b (S1): Urnik steps by week where the week view is offered (md up), by day on a phone (D4).
  const roster = props.view === "roster";
  const week = props.view === "week" || (roster && weekAvailable);
  const step = week ? 7 : 1;
  const dated = !(roster && props.rosterMode === "usual");
  // Flowko U29f (R2–R7): one set of picker props for the day, week and Urnik views (phone included).
  const calendarProps = {
    locale: deskPickerLocale(i18n?.language),
    // Desk weeks are Monday-based in every language (R2).
    weekStartsOn: 1 as const,
    // The business today, not the browser clock (R5).
    today: toPickerDate(today),
    // Outside days would look like month days; hidden instead of dimmed (R6).
    showOutsideDays: false,
    classNames: {
      // R6: the four-character Slovene weekday abbreviations fit a 32 px phone cell.
      head_cell: "w-8 md:w-11 h-8 text-xs md:text-sm font-medium text-default text-center",
      // R5: a brand edge and bold number; no text colour, so today + selected never fight over `color`.
      day_today: "font-semibold! border-brand-default!",
    },
    labels: {
      labelPrevious: () => t("view_previous_month"),
      labelNext: () => t("view_next_month"),
    },
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dated && (
        <>
          <Button
            variant="icon"
            color="secondary"
            StartIcon="chevron-left"
            aria-label={t(week ? "flowko_desk_prev_week" : "flowko_desk_prev_day")}
            onClick={() => go(addDays(date, -step))}
          />
          <Button color="secondary" disabled={date === today} onClick={() => onDateChange(null)}>
            {t("today")}
          </Button>
          <Button
            variant="icon"
            color="secondary"
            StartIcon="chevron-right"
            aria-label={t(week ? "flowko_desk_next_week" : "flowko_desk_next_day")}
            onClick={() => go(addDays(date, step))}
          />
          <DatePicker
            date={toPickerDate(date)}
            minDate={null}
            onDatesChange={(d) => go(fromPickerDate(d))}
            calendarProps={calendarProps}
            label={
              week
                ? formatWeekLabel(date, i18n?.language ?? "sl")
                : formatDateLabel(date, i18n?.language ?? "sl")
            }
          />
        </>
      )}
      <ToggleGroup
        value={props.view}
        onValueChange={(v) => props.onViewChange(v as DeskViewKind)}
        options={[
          { value: "day", label: t("flowko_desk_view_day") },
          { value: "week", label: t("flowko_desk_view_week"), disabled: !weekAvailable },
          // Flowko U29b (S1, D2): Urnik on every size.
          { value: "roster", label: t("flowko_roster_view") },
        ]}
      />
      {!weekAvailable && (
        <span data-testid="desk-week-hint" className="text-subtle text-xs">
          {t("flowko_desk_week_phone_hint")}
        </span>
      )}
    </div>
  );
}
