import { contructEmailFromPhoneNumber } from "@calcom/lib/contructEmailFromPhoneNumber";
import type { BookingStatus } from "@calcom/prisma/enums";

/**
 * The booking services return far more than the booker may see: the organizer's one-time
 * accept/reject token, the calendar and video references (external calendar ID, event IDs,
 * credential IDs), the video call link, host user IDs, the organizer's email, payment rows and,
 * when an existing booking is returned instead of a new one, the organizer's full user row and
 * every attendee. The booker's browser passes the response on to the embedding page and to
 * analytics apps, so the public booking endpoints return only what the booker UI reads.
 */

type BookingAttendeeForBooker = {
  name?: string | null;
  email?: string | null;
  timeZone?: string | null;
};

/** The fields read from a booking service result. Everything else is dropped. */
export type BookingForBooker = {
  uid?: string | null;
  title?: string | null;
  description?: string | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  location?: string | null;
  status?: BookingStatus | null;
  eventTypeId?: number | null;
  responses?: unknown;
  user?: { name?: string | null; timeZone?: string | null } | null;
  attendees?: BookingAttendeeForBooker[] | null;
  paymentRequired?: boolean | null;
  paymentUid?: string | null;
  seatReferenceUid?: string | null;
  isDryRun?: boolean | null;
  isShortCircuitedBooking?: boolean | null;
};

export type PublicBookingAttendee = {
  name: string;
  email: string;
  timeZone: string;
};

export type PublicBookingResponse = {
  uid?: string;
  title?: string;
  description?: string | null;
  startTime?: Date | string;
  endTime?: Date | string;
  location?: string | null;
  status?: BookingStatus;
  eventTypeId?: number | null;
  responses?: unknown;
  /** The organizer's display name and time zone. The email is never returned. */
  user: { name: string | null; timeZone: string; email: null } | null;
  /** Only the attendees whose email the booker entered: the booker and their guests. */
  attendees: PublicBookingAttendee[];
  paymentRequired: boolean;
  paymentUid?: string;
  seatReferenceUid?: string;
  isDryRun: boolean;
  isShortCircuitedBooking?: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * The emails the booker entered in the request: their own, their guests', and the placeholder
 * address a phone-only booking is stored under. Accepts one booking request body or the array
 * a recurring booking sends.
 */
export function getBookerSubmittedEmails(body: unknown): Set<string> {
  const emails = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) emails.add(normaliseEmail(value));
  };

  for (const item of Array.isArray(body) ? body : [body]) {
    if (!isRecord(item)) continue;
    // `responses` is what the booking form sends; the legacy API props sit at the top level
    for (const source of [item.responses, item]) {
      if (!isRecord(source)) continue;
      add(source.email);
      if (Array.isArray(source.guests)) source.guests.forEach(add);
      if (typeof source.attendeePhoneNumber === "string" && source.attendeePhoneNumber) {
        add(contructEmailFromPhoneNumber(source.attendeePhoneNumber));
      }
    }
  }
  return emails;
}

/**
 * Keeps only what the booker UI, the success redirect and the embed events read from a created
 * (or rescheduled, seated, recurring, dry-run or decoy) booking.
 */
export function toPublicBookingResponse(
  booking: BookingForBooker,
  bookerSubmittedEmails: Set<string>
): PublicBookingResponse {
  const isSubmittedByBooker = (email: string | null | undefined) =>
    !!email && bookerSubmittedEmails.has(normaliseEmail(email));

  // An existing booking is returned when one of its attendees has the email the booker entered,
  // which can be a guest's. Its form answers, notes, title and location then belong to whoever
  // made that booking, so they are only returned when that person is the booker.
  const bookingEmail = isRecord(booking.responses) ? booking.responses.email : undefined;
  const isBookersOwnBooking =
    typeof bookingEmail !== "string" || !bookingEmail || isSubmittedByBooker(bookingEmail);

  const attendees = (booking.attendees ?? []).flatMap((attendee) =>
    isSubmittedByBooker(attendee.email)
      ? [
          {
            name: attendee.name ?? "",
            email: attendee.email ?? "",
            timeZone: attendee.timeZone ?? "",
          },
        ]
      : []
  );

  return {
    uid: booking.uid ?? undefined,
    title: isBookersOwnBooking ? (booking.title ?? undefined) : undefined,
    description: isBookersOwnBooking ? booking.description : undefined,
    startTime: booking.startTime ?? undefined,
    endTime: booking.endTime ?? undefined,
    location: isBookersOwnBooking ? booking.location : undefined,
    status: booking.status ?? undefined,
    eventTypeId: booking.eventTypeId,
    responses: isBookersOwnBooking ? booking.responses : undefined,
    user: booking.user
      ? { name: booking.user.name ?? null, timeZone: booking.user.timeZone || "UTC", email: null }
      : null,
    attendees,
    paymentRequired: !!booking.paymentRequired,
    paymentUid: booking.paymentUid ?? undefined,
    seatReferenceUid: booking.seatReferenceUid ?? undefined,
    isDryRun: !!booking.isDryRun,
    ...(booking.isShortCircuitedBooking ? { isShortCircuitedBooking: true as const } : {}),
  };
}
