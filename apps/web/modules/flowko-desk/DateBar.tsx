// Flowko U28: the date bar of the desk and its URL state (?date=&view=&worker=). `date` is a business-local
// "YYYY-MM-DD"; no or a malformed date means today in the business time zone (decided by the caller from the
// server's clock). Previous/next step by calendar days (DST-safe, roster `addDays`). The week toggle renders
// disabled until the week view exists (Task 8).
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";

import { addDays, localDateSchema } from "@calcom/lib/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { DatePicker, ToggleGroup } from "@calcom/ui/components/form";

export const DESK_VIEWS = ["day", "week"] as const;
export type DeskViewKind = (typeof DESK_VIEWS)[number];

export function useDeskParams() {
  const [rawDate, setRawDate] = useQueryState("date", parseAsString);
  const [view, setView] = useQueryState("view", parseAsStringLiteral(DESK_VIEWS).withDefault("day"));
  const [worker, setWorker] = useQueryState("worker", parseAsInteger);
  const date = rawDate !== null && localDateSchema.safeParse(rawDate).success ? rawDate : null;
  return {
    state: { date, view, worker },
    /** null = today (drops the parameter). */
    setDate: (next: string | null) => void setRawDate(next),
    setView: (next: DeskViewKind) => void setView(next),
    setWorker: (next: number | null) => void setWorker(next),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar shows the browser's local midnight of the business date; a picked day maps back by its fields. */
const toPickerDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fromPickerDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function formatDateLabel(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function DateBar(props: {
  date: string;
  today: string;
  view: DeskViewKind;
  onDateChange: (date: string | null) => void;
  onViewChange: (view: DeskViewKind) => void;
}) {
  const { t, i18n } = useLocale();
  const { date, today, onDateChange } = props;
  const go = (next: string) => onDateChange(next === today ? null : next);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="icon"
        color="secondary"
        StartIcon="chevron-left"
        aria-label={t("flowko_desk_prev_day")}
        onClick={() => go(addDays(date, -1))}
      />
      <Button color="secondary" disabled={date === today} onClick={() => onDateChange(null)}>
        {t("today")}
      </Button>
      <Button
        variant="icon"
        color="secondary"
        StartIcon="chevron-right"
        aria-label={t("flowko_desk_next_day")}
        onClick={() => go(addDays(date, 1))}
      />
      <DatePicker
        date={toPickerDate(date)}
        minDate={null}
        onDatesChange={(d) => go(fromPickerDate(d))}
        label={formatDateLabel(date, i18n?.language ?? "sl")}
      />
      <ToggleGroup
        value={props.view}
        onValueChange={(v) => props.onViewChange(v as DeskViewKind)}
        options={[
          { value: "day", label: t("flowko_desk_view_day") },
          // Flowko U28: enabled by Task 8 (week view).
          { value: "week", label: t("flowko_desk_view_week"), disabled: true },
        ]}
      />
    </div>
  );
}
