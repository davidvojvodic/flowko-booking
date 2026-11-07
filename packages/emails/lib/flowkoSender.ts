// Flowko U27: the sender display name of the customer's mails (E1). A business booking's mails come from the
// business, every other booking's from the organizer, as in Cal.
import type { CalendarEvent } from "@calcom/types/Calendar";

// RFC 5322 specials: a display name holding one must be a quoted string, or the From header splits.
const NEEDS_QUOTING = /[()<>[\]:;@\\,."]/;

/** The display name for an attendee mail's From: the business name ?? the organizer's name. */
export function attendeeFromName(calEvent: Pick<CalendarEvent, "organizer" | "flowkoBusiness">): string {
  const businessName = calEvent.flowkoBusiness?.name;
  if (!businessName) return calEvent.organizer.name;
  return NEEDS_QUOTING.test(businessName) ? `"${businessName.replace(/(["\\])/g, "\\$1")}"` : businessName;
}
