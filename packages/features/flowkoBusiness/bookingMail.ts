// Flowko U27: Cal's mails for a business booking, sent after the writer's transaction has committed. The event is
// built from the stored booking (CalendarEventBuilder.fromBooking, which carries the business name and phone for
// the mail templates, E1/E2); `type` is the mirror's title (the business name) instead of the mirror slug, as the
// U22 reminder cron does. The stored title is kept: the title source names the mirror's own template, so
// getBookerEventTitle returns Booking.title, and no eventNameObject is passed (it would rebuild the title from the
// mirror template). Each sender logs its own failure (booking id and error class only) and never throws: a mail
// never undoes a booking. Server only.
import {
  sendCancelledEmailsAndSMS,
  sendRescheduledEmailsAndSMS,
  sendScheduledEmailsAndSMS,
} from "@calcom/emails/email-manager";
import type { BookerTitleSource } from "@calcom/emails/lib/getBookerEventTitle";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { CalendarEventBuilder } from "@calcom/features/CalendarEventBuilder";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import type { CalendarEvent } from "@calcom/types/Calendar";

const log = logger.getSubLogger({ prefix: ["flowko-business-booking-mail"] });

const MINUTE_MS = 60_000;

type MailKind = "created" | "moved" | "cancelled";

type BusinessEvent = {
  evt: CalendarEvent;
  metadata: Parameters<typeof sendScheduledEmailsAndSMS>[4];
  titleSource: BookerTitleSource;
  lengthMinutes: number;
};

/** The stored booking as Cal's mail event; throws for a missing booking or one that is not on a mirror. */
async function businessEvent(bookingId: number): Promise<BusinessEvent> {
  const row = await new BookingRepository(prisma).getBookingForCalEventBuilder(bookingId);
  if (!row?.eventType?.flowkoWorkerMirror) throw new Error("Flowko U27: not a business booking");
  const { eventType } = row;
  const built = (await CalendarEventBuilder.fromBooking(row)).build();
  // Mirrors are written by Flowko with a valid metadata object; unreadable metadata only loses the opt-outs
  // (disableStandardEmails), which mirrors never set.
  const parsed = EventTypeMetaDataSchema.safeParse(eventType.metadata);
  return {
    evt: { ...built, type: eventType.title },
    metadata: parsed.success ? (parsed.data ?? undefined) : undefined,
    titleSource: { eventType: eventType.title, eventName: eventType.eventName },
    lengthMinutes: Math.round((row.endTime.getTime() - row.startTime.getTime()) / MINUTE_MS),
  };
}

async function sendLogged(kind: MailKind, bookingId: number, send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (error) {
    log.error("business booking mail not sent", {
      kind,
      bookingId,
      errorClass: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** The customer's and the worker's „booked“ mails. */
export function sendBusinessBookingCreated(bookingId: number): Promise<void> {
  return sendLogged("created", bookingId, async () => {
    const { evt, metadata, titleSource } = await businessEvent(bookingId);
    await sendScheduledEmailsAndSMS(evt, undefined, false, false, metadata, titleSource);
  });
}

/** The „moved“ mails (no request-to-reschedule reason). */
export function sendBusinessBookingMoved(bookingId: number): Promise<void> {
  return sendLogged("moved", bookingId, async () => {
    const { evt, metadata, titleSource } = await businessEvent(bookingId);
    await sendRescheduledEmailsAndSMS(evt, metadata, titleSource);
  });
}

/** The „cancelled“ mails; `length` is set because Cal's cancel sender logs an error without it. */
export function sendBusinessBookingCancelled(bookingId: number): Promise<void> {
  return sendLogged("cancelled", bookingId, async () => {
    const { evt, metadata, titleSource, lengthMinutes } = await businessEvent(bookingId);
    await sendCancelledEmailsAndSMS({ ...evt, length: lengthMinutes }, titleSource, metadata);
  });
}
