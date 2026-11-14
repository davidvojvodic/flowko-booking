"use client";

import dayjs from "@calcom/dayjs";
import cn from "@calcom/ui/classNames";
import { ChevronLeftIcon, ChevronRightIcon } from "@coss/ui/icons";
// Flowko U29f: date-fns formats the caption when a caller passes a locale (the desk's Slovene picker).
import { format } from "date-fns";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { buttonClasses } from "../../button/Button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  fromDate,
  toDate,
  showOutsideDays = true,
  // Flowko U29f: destructured so the caption can use it; passed on to DayPicker explicitly below.
  locale,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      fromDate={fromDate}
      toDate={toDate || undefined}
      showOutsideDays={showOutsideDays}
      locale={locale}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row stack-y-4 sm:space-x-4 sm:stack-y-0",
        month: "stack-y-4",
        caption: "flex pt-1 relative items-center justify-between",
        caption_label: "text-sm font-medium",
        nav: "flex items-center",
        head: "",
        head_row: "flex w-full items-center justify-between",
        head_cell: "w-8 md:w-11 h-8 text-sm font-medium text-default text-center",
        nav_button: cn(buttonClasses({ color: "minimal", variant: "icon" })),
        table: "w-full border-collapse stack-y-1",
        row: "flex w-full mt-0.5 gap-0.5",
        cell: "w-8 h-8 md:h-11 md:w-11 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day: cn(
          buttonClasses({ color: "minimal" }),
          "w-8 h-8 md:h-11 md:w-11 p-0 text-sm font-medium aria-selected:opacity-100 inline-flex items-center justify-center"
        ),
        // Flowko U29f: every picker's selected day in the brand pair (#7A3FD1 / white 6.07:1; dark
        // #AC6AFF / black 6.26:1) instead of near-black with grey text. The `!` beats the minimal
        // button's text-subtle, hover and focus-visible colours; the ring keeps keyboard focus visible.
        // Range ends take the same pair; the days between keep their own pair (`!` + aria-selected
        // outranks the selected pair): #1A1A2E on #E8E0F5 13.33:1, dark #FAFAFA on #404040 9.93:1.
        day_range_end: "bg-brand-default! text-brand!",
        day_range_start: "bg-brand-default! text-brand!",
        day_selected:
          "bg-brand-default! text-brand! focus-visible:ring-2! focus-visible:ring-brand-default! focus-visible:ring-offset-2!",
        day_today: "",
        day_outside: "",
        day_disabled: "text-muted opacity-50",
        day_range_middle: "aria-selected:bg-emphasis! aria-selected:text-emphasis!",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        CaptionLabel: (capLabelProps) => (
          <div className="px-2">
            <span className="text-emphasis font-semibold leading-none">
              {/* Flowko U29f: date-fns standalone month in the caller's locale; else dayjs as before. */}
              {locale !== undefined
                ? format(capLabelProps.displayMonth, "LLLL", { locale })
                : dayjs(capLabelProps.displayMonth).format("MMMM")}{" "}
            </span>
            <span className="text-subtle font-medium leading-none">
              {locale !== undefined
                ? format(capLabelProps.displayMonth, "y", { locale })
                : dayjs(capLabelProps.displayMonth).format("YYYY")}
            </span>
          </div>
        ),
        IconLeft: () => <ChevronLeftIcon className="h-4 w-4 stroke-2" />,
        IconRight: () => <ChevronRightIcon className="h-4 w-4 stroke-2" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
