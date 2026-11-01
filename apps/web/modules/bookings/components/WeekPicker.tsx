import { useState, useEffect } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { formatLocalizedDay } from "@calcom/lib/formatLocalizedDate";
import dayjs from "@calcom/dayjs";
import { DatePicker } from "@calcom/ui/components/form";

import { getWeekStart } from "../lib/weekUtils";

interface WeekPickerProps {
  currentWeekStart: dayjs.Dayjs;
  userWeekStart: number;
  onDateChange: (date: dayjs.Dayjs) => void;
}

export function WeekPicker({ currentWeekStart, userWeekStart, onDateChange }: WeekPickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(currentWeekStart.toDate());
  useEffect(() => {
    setSelectedDate(currentWeekStart.toDate());
  }, [currentWeekStart]);

  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    const selectedDayjs = dayjs(date);
    const newWeekStart = getWeekStart(selectedDayjs, userWeekStart);
    onDateChange(newWeekStart);
  };

  const weekStart = currentWeekStart;
  const weekEnd = currentWeekStart.add(6, "day");
  const { i18n } = useLocale();
  const short = (date: dayjs.Dayjs) =>
    formatLocalizedDay(date, i18n.language, { day: "numeric", month: "short" }, null);
  const weekRange = `${short(weekStart)} - ${short(weekEnd)}, ${weekEnd.format("YYYY")}`;

  return <DatePicker date={selectedDate} onDatesChange={handleDateChange} minDate={null} label={weekRange} />;
}
