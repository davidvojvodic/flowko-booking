// Flowko U29a: the per-weekday time-ranges editor (S16): the business opening hours now, the roster's shifts in
// U29b. Per weekday a list of from–to rows with 24-hour selects in 15-minute steps from 03:00 to 24:00 (the floor
// of openingHoursSchema), „Dodaj“ / remove per row, „Zaprto“ when a day is empty, „Kopiraj v vse dni“ from Monday.
// Controlled and rule-free: the caller validates (openingHoursSchema / shiftDaySchema) and passes each day's
// translated error. A stored time off the 15-minute grid stays selectable, so loading never changes a value.
import { WEEKDAYS, type Weekday } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { useId } from "react";

export type DayRange = { from: string; to: string };
export type DayRanges = Record<Weekday, DayRange[]>;

const FIRST_MINUTE = 3 * 60;
const LAST_MINUTE = 24 * 60;
const STEP_MINUTES = 15;

function hm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** "03:00", "03:15", … "24:00". */
export const TIME_OPTIONS: readonly string[] = Array.from(
  { length: (LAST_MINUTE - FIRST_MINUTE) / STEP_MINUTES + 1 },
  (_, i) => hm(FIRST_MINUTE + i * STEP_MINUTES)
);

/** Cal's weekday keys ("monday" …), shared with its own schedule screens. */
const DAY_KEYS: Record<Weekday, string> = {
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
  sun: "sunday",
};

const DEFAULT_RANGE: DayRange = { from: "08:00", to: "16:00" };

/** The range „Dodaj“ appends: 08:00–16:00 on an empty day, else one hour after the last range (to 24:00 at most). */
function nextRange(ranges: DayRange[]): DayRange {
  const last = ranges[ranges.length - 1];
  if (!last) return { ...DEFAULT_RANGE };
  const from = minutesOf(last.to);
  return { from: last.to, to: hm(Math.min(from + 60, LAST_MINUTE)) };
}

function optionsWith(value: string): readonly string[] {
  return TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [value, ...TIME_OPTIONS].sort();
}

const SELECT_CLASS = "border-default bg-default text-emphasis h-9 rounded-md border px-2 text-sm";

export function DayRangesEditor(props: {
  value: DayRanges;
  onChange: (next: DayRanges) => void;
  /** Translated error per weekday, shown under its row. */
  dayErrors?: Partial<Record<Weekday, string>>;
  disabled?: boolean;
  /** data-testid prefix (two editors on one page stay apart). */
  testIdPrefix?: string;
}) {
  const { t } = useLocale();
  const { value, onChange, dayErrors, disabled } = props;
  const prefix = props.testIdPrefix ?? "flowko-day-ranges";
  // Flowko U29b: a day's error gets an id so that day's selects can point at it (aria-describedby, D1 a).
  const idBase = useId();

  const setDay = (day: Weekday, ranges: DayRange[]) => onChange({ ...value, [day]: ranges });
  const setTime = (day: Weekday, index: number, edge: keyof DayRange, time: string) =>
    setDay(
      day,
      value[day].map((range, i) => (i === index ? { ...range, [edge]: time } : range))
    );
  const copyMondayToAll = () => {
    const week = {} as DayRanges;
    for (const day of WEEKDAYS) week[day] = value.mon.map((range) => ({ ...range }));
    onChange(week);
  };

  return (
    <div className="flex flex-col gap-4">
      {WEEKDAYS.map((day) => {
        const dayName = t(DAY_KEYS[day]);
        const ranges = value[day];
        const error = dayErrors?.[day];
        const errorId = `${idBase}-${day}-error`;
        return (
          <div key={day} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <span className="text-emphasis w-32 shrink-0 pt-2 text-sm font-medium capitalize">{dayName}</span>
            <div className="flex flex-1 flex-col gap-2">
              {ranges.length === 0 && (
                <span data-testid={`${prefix}-${day}-closed`} className="text-subtle pt-2 text-sm">
                  {t("flowko_settings_closed")}
                </span>
              )}
              {ranges.map((range, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position
                <div key={index} className="flex items-center gap-2">
                  {(["from", "to"] as const).map((edge) => (
                    <select
                      key={edge}
                      data-testid={`${prefix}-${day}-${index}-${edge}`}
                      aria-label={t(
                        edge === "from" ? "flowko_settings_range_from" : "flowko_settings_range_to",
                        {
                          day: dayName,
                        }
                      )}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      className={SELECT_CLASS}
                      disabled={disabled}
                      value={range[edge]}
                      onChange={(e) => setTime(day, index, edge, e.target.value)}>
                      {optionsWith(range[edge]).map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  ))}
                  <Button
                    type="button"
                    variant="icon"
                    color="minimal"
                    StartIcon="trash-2"
                    data-testid={`${prefix}-${day}-${index}-remove`}
                    aria-label={t("flowko_settings_range_remove", { day: dayName })}
                    disabled={disabled}
                    onClick={() =>
                      setDay(
                        day,
                        ranges.filter((_, i) => i !== index)
                      )
                    }
                  />
                </div>
              ))}
              {error && (
                <p
                  id={errorId}
                  role="alert"
                  data-testid={`${prefix}-${day}-error`}
                  className="text-error text-sm">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  color="minimal"
                  size="sm"
                  StartIcon="plus"
                  data-testid={`${prefix}-${day}-add`}
                  aria-label={t("flowko_settings_add_range_day", { day: dayName })}
                  disabled={disabled || ranges[ranges.length - 1]?.to === "24:00"}
                  onClick={() => setDay(day, [...ranges, nextRange(ranges)])}>
                  {t("flowko_settings_add_range")}
                </Button>
                {day === "mon" && (
                  <Button
                    type="button"
                    color="minimal"
                    size="sm"
                    StartIcon="copy"
                    data-testid={`${prefix}-copy`}
                    disabled={disabled}
                    onClick={copyMondayToAll}>
                    {t("flowko_settings_copy_to_all")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
