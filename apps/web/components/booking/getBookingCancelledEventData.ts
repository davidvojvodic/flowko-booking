type BookingCancelledEventProps = {
  booking: unknown;
  organizer: {
    name: string;
    email: string;
    timeZone?: string;
  };
  eventType: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The bookingCancelled event reaches the embedding page and the analytics apps on the booking page.
 * Callers pass the whole booking and event type (on the booking page: the organizer's user row, every
 * attendee with their phone number, every host with their email), so only the fields that identify
 * the cancelled booking are sent.
 */
export function getBookingCancelledEventData(
  { booking, organizer, eventType }: BookingCancelledEventProps,
  cancellationReason: string
) {
  const bookingFields = isRecord(booking) ? booking : {};
  const eventTypeFields = isRecord(eventType) ? eventType : {};
  return {
    booking: {
      uid: bookingFields.uid,
      title: bookingFields.title,
      startTime: bookingFields.startTime,
      endTime: bookingFields.endTime,
      status: bookingFields.status,
      cancellationReason,
    },
    organizer: {
      name: organizer.name,
      // Same placeholder the booking events use when the organizer's email isn't known
      email: "Email-less",
      timeZone: organizer.timeZone,
    },
    eventType: {
      id: eventTypeFields.id,
      slug: eventTypeFields.slug,
      title: eventTypeFields.title,
    },
  };
}
