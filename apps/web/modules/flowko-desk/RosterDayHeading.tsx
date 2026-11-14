// Flowko U29b (Task 7, S1, S8): a day header of Urnik in „Ta teden“: the date as its own button (a tap opens Dan for
// that date; the caller guards it, S13) and, on a holiday, the holiday label (the owner's menu is a separate button,
// so a tap on the label never navigates). Used by the grid's sticky header and by the phone day list.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { RosterHolidayMenu } from "./RosterHolidayMenu";
import { formatDayLabel } from "./WeekGrid";
import { type RosterLayout, formatRosterHeader } from "./rosterModel";

export function RosterDayHeading(props: {
  layout: RosterLayout;
  date: string;
  onOpenDay: (date: string) => void;
  // Flowko U29c (P6): the grid's header is two lines (weekday, date); the phone list keeps today's one line.
  variant: "grid" | "list";
}) {
  const { i18n } = useLocale();
  const { layout, date } = props;
  const holiday = layout.view.days.find((d) => d.date === date)?.holiday ?? null;
  const isToday = date === layout.today;
  const language = i18n?.language ?? "sl";
  const header = formatRosterHeader(date, language);
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <button
        type="button"
        data-testid={`roster-header-${date}`}
        data-today={isToday ? "true" : undefined}
        onClick={() => props.onOpenDay(date)}
        className={classNames(
          // Flowko U29c (P6): the grid's two lines never truncate; the list's one line does as before.
          "hover:bg-subtle max-w-full rounded text-left text-sm font-semibold",
          // Flowko U29h: `truncate` hides overflow, and at text-sm's 20 px line box Plus Jakarta Sans' descenders
          // were cut („pon.“ read as „bon.“ on a phone, David 14 Nov); a 24 px line box shows them whole.
          props.variant === "list" && "truncate leading-6",
          isToday ? "text-brand-default" : "text-emphasis"
        )}>
        {props.variant === "grid" ? (
          <>
            <span data-testid="roster-header-weekday" className="block">
              <span data-form="short" className="xl:hidden">
                {header.weekdayShort}
              </span>
              <span data-form="long" className="hidden xl:inline">
                {header.weekdayLong}
              </span>
            </span>
            <span data-testid="roster-header-date" className="block">
              {header.date}
            </span>
          </>
        ) : (
          formatDayLabel(date, language)
        )}
      </button>
      {holiday && (
        <RosterHolidayMenu
          date={date}
          holiday={holiday}
          holidaysClosed={layout.view.holidaysClosed}
          canManage={layout.canManageHoliday(date)}
          dirty={layout.dirty}
          // Flowko U29c (P1, R11): the refresh after a holiday change answers to RosterView's notice.
          onRefreshed={layout.onRefreshed}
        />
      )}
    </div>
  );
}
