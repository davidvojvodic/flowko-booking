// Flowko U29b (Task 7, S1, S8): a day header of Urnik in „Ta teden“: the date as its own button (a tap opens Dan for
// that date; the caller guards it, S13) and, on a holiday, the holiday label (the owner's menu is a separate button,
// so a tap on the label never navigates). Used by the grid's sticky header and by the phone day list.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { RosterHolidayMenu } from "./RosterHolidayMenu";
import { formatDayLabel } from "./WeekGrid";
import type { RosterLayout } from "./rosterModel";

export function RosterDayHeading(props: {
  layout: RosterLayout;
  date: string;
  onOpenDay: (date: string) => void;
}) {
  const { i18n } = useLocale();
  const { layout, date } = props;
  const holiday = layout.view.days.find((d) => d.date === date)?.holiday ?? null;
  const isToday = date === layout.today;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <button
        type="button"
        data-testid={`roster-header-${date}`}
        data-today={isToday ? "true" : undefined}
        onClick={() => props.onOpenDay(date)}
        className={classNames(
          "hover:bg-subtle max-w-full truncate rounded text-left text-sm font-semibold",
          isToday ? "text-brand-default" : "text-emphasis"
        )}>
        {formatDayLabel(date, i18n?.language ?? "sl")}
      </button>
      {holiday && (
        <RosterHolidayMenu
          date={date}
          holiday={holiday}
          holidaysClosed={layout.view.holidaysClosed}
          canManage={layout.canManageHoliday(date)}
          dirty={layout.dirty}
        />
      )}
    </div>
  );
}
