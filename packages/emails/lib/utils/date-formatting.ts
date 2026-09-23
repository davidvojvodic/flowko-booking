import dayjs from "@calcom/dayjs";
import { formatDateTime } from "@calcom/lib/dateTimeFormatter";
import { getTimeFormatForLocale } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

/**
 * Formats the date the way the recipient's locale writes it,
 * e.g. "Friday, October 23, 2026" for "en" and "petek, 23. oktober 2026" for "sl".
 */
export function formatRecipientDate({
  time,
  timeZone,
  locale,
}: {
  time: string;
  timeZone: string;
  locale: string;
}): string {
  const date = dayjs(time).toDate();
  try {
    return formatDateTime(date, { locale, timeZone, dateStyle: "full" });
  } catch {
    // Intl throws on a malformed locale tag, fall back to English like the translations do
    return formatDateTime(date, { locale: "en", timeZone, dateStyle: "full" });
  }
}

export function getFormattedDate(calEvent: CalendarEvent, attendee: Person): string {
  const inviteeTimeFormat = calEvent.organizer.timeFormat || getTimeFormatForLocale(attendee.language.locale);
  const timezone = attendee.timeZone;
  const locale = attendee.language.locale;

  const getFormattedRecipientTime = (time: string, format: string) => {
    return dayjs(time).tz(timezone).locale(locale).format(format);
  };

  const getInviteeStart = (format: string) => {
    return getFormattedRecipientTime(calEvent.startTime, format);
  };

  const getInviteeEnd = (format: string) => {
    return getFormattedRecipientTime(calEvent.endTime, format);
  };

  return `${getInviteeStart(inviteeTimeFormat)} - ${getInviteeEnd(inviteeTimeFormat)}, ${formatRecipientDate({
    time: calEvent.startTime,
    timeZone: timezone,
    locale,
  })}`;
}
