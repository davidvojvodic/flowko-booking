import { getEventName } from "@calcom/features/eventtypes/lib/eventNaming";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

/**
 * What a booking's title is made of. `eventName` undefined means the caller doesn't know whether the event type
 * has a name template, which is not the same as null, none.
 */
export type BookerTitleSource = { eventType?: string | null; eventName?: string | null };

/**
 * Flowko: `calEvent.title` is built once, in the host's language („Ogled med Hana in Bob“). A recipient's copy is
 * rebuilt in their own language, always with the booker's name: a guest has no name of their own.
 *
 * Only the default title has words of its own. A host's template has none, while its {Location} and
 * {Scheduler last name} need the raw answers of booking time, so it stays as stored. So does a title whose parts
 * are unknown.
 */
export const getBookerEventTitle = (
  calEvent: Pick<CalendarEvent, "title" | "attendees" | "organizer" | "team">,
  attendee: Pick<Person, "language">,
  source?: BookerTitleSource
): string => {
  const bookerName = calEvent.attendees[0]?.name;
  if (!source?.eventType || source.eventName === undefined || source.eventName || !bookerName) {
    return calEvent.title;
  }
  return getEventName({
    attendeeName: bookerName,
    eventType: source.eventType,
    host: calEvent.organizer.name,
    teamName: calEvent.team?.name,
    eventDuration: 0,
    t: attendee.language.translate,
  });
};
