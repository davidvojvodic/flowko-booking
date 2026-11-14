import * as Popover from "@radix-ui/react-popover";
import { formatLocalizedDay } from "@calcom/lib/formatLocalizedDate";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { Button } from "../../button/Button";
import { Calendar } from "../date-range-picker/Calendar";
// Flowko U29f: the Calendar's prop type for calendarProps.
import type { CalendarProps } from "../date-range-picker/Calendar";

type Props = {
  date: Date;
  onDatesChange?: ((date: Date) => void) | undefined;
  className?: string;
  disabled?: boolean;
  minDate?: Date | null;
  label?: string;
  // Flowko U29f: optional pass-through to the Calendar (the desk sets locale, Monday start, its own
  // today, hidden outside days, classNames and nav labels); absent = unchanged behaviour.
  calendarProps?: Pick<
    CalendarProps,
    "locale" | "weekStartsOn" | "classNames" | "labels" | "today" | "showOutsideDays"
  >;
};

// Flowko U29f: calendarProps destructured (spread into <Calendar> below).
const DatePicker = ({ minDate, disabled, date, onDatesChange, className, label, calendarProps }: Props) => {
  const { t, i18n } = useLocale();
  function handleDayClick(newDate: Date) {
    onDatesChange?.(newDate ?? new Date());
  }
  const fromDate = minDate ?? new Date();
  const calendar = (
    <Calendar
      initialFocus
      fromDate={minDate === null ? undefined : fromDate}
      // toDate={maxDate}
      mode="single"
      defaultMonth={date}
      selected={date}
      onDayClick={(day) => handleDayClick(day)}
      numberOfMonths={1}
      disabled={disabled}
      // Flowko U29f: spread last, after the picker's own props.
      {...calendarProps}
    />
  );

  return (
    <div className={classNames("grid gap-2", className)}>
      {/* modal prop required for iOS compatibility when nested inside Dialog modals */}
      <Popover.Root modal>
        <Popover.Trigger asChild>
          <Button
            data-testid="pick-date"
            color="secondary"
            EndIcon="calendar"
            className={classNames("justify-between text-left font-normal", !date && "text-subtle")}>
            {label ?? (date ? <>{formatLocalizedDay(date, i18n.language, undefined, null)}</> : <span>{t("pick_a_date")}</span>)}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
        <Popover.Content
          className="bg-default text-emphasis z-50 w-auto rounded-md border p-0 outline-none"
          align="start"
          sideOffset={4}
          >
          {calendar}
        </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
};

export default DatePicker;
