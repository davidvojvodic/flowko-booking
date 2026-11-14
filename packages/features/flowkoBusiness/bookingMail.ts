// Flowko U27: Cal's mails for a business booking, sent after the writer's transaction has committed. The event is
// built from the stored booking (CalendarEventBuilder.fromBooking, which carries the business name and phone for
// the mail templates, E1/E2); `type` is the mirror's title (the business name) instead of the mirror slug, as the
// U22 reminder cron does. The stored title is kept: the title source names the mirror's own template, so
// getBookerEventTitle returns Booking.title, and no eventNameObject is passed (it would rebuild the title from the
// mirror template). Each sender logs its own failure (booking id and error class only) and never throws: a mail
// never undoes a booking. Server only.
// Flowko U29e: E7, R13 — `sendBusinessCancelNotice`, the business's own notice on a customer cancel (one more
// mail after Cal's cancelled mails; reached only through bookingWriter's sendMailAfterCommit("cancel_notice")).
import {
  sendCancelledEmailsAndSMS,
  sendFlowkoCancelNoticeEmail, // Flowko U29e: E7
  sendRescheduledEmailsAndSMS,
  sendScheduledEmailsAndSMS,
} from "@calcom/emails/email-manager";
import type { BookerTitleSource } from "@calcom/emails/lib/getBookerEventTitle";
import type { FlowkoCancelNoticeMail } from "@calcom/emails/templates/flowko-cancel-notice-email"; // Flowko U29e
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { CalendarEventBuilder } from "@calcom/features/CalendarEventBuilder";
import { WEBAPP_URL } from "@calcom/lib/constants"; // Flowko U29e: E7
import { formatHm } from "@calcom/lib/flowkoBusiness/desk"; // Flowko U29e: E7
import { slInviteDate } from "@calcom/lib/flowkoBusiness/invites"; // Flowko U29e: E7
import { todayIn } from "@calcom/lib/flowkoBusiness/roster"; // Flowko U29e: E7
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail"; // Flowko U29e: E7
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums"; // Flowko U29e: E7
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

/** Flowko U29e: E7 — what the notice mail is built from (the template's own type). */
export type CancelNoticeArgs = FlowkoCancelNoticeMail;

/** Flowko U29e: E7 — why no notice could be built (logged as the outcome, like a mail outcome). */
type NoNotice = "not_business_booking" | "not_cancelled" | "no_recipient";

/**
 * Flowko U29e: E7, R13 — the notice's content, read from the committed booking: the customer (first attendee; the
 * phone when stored; Reply-To only for a real address), the distinct service names in step order, the worker's
 * current Flowko name, the business-local date and times, the stored reason and the desk day link. To = the
 * business e-mail, else the OWNER's login e-mail read through the member relation (the excludeLockedUsers
 * extension never hides it; an OWNER is always a login user).
 */
async function cancelNoticeArgs(bookingId: number): Promise<CancelNoticeArgs | NoNotice> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      status: true,
      startTime: true,
      endTime: true,
      cancellationReason: true,
      eventTypeId: true,
      attendees: { select: { name: true, email: true, phoneNumber: true }, orderBy: { id: "asc" }, take: 1 },
      flowkoBookingSteps: { select: { serviceName: true }, orderBy: { index: "asc" } },
    },
  });
  if (!booking || booking.eventTypeId === null) return "not_business_booking";
  const mirror = await prisma.flowkoWorkerMirror.findUnique({
    where: { eventTypeId: booking.eventTypeId },
    select: {
      businessId: true,
      member: { select: { displayName: true } },
      business: { select: { email: true, timeZone: true } },
    },
  });
  if (!mirror) return "not_business_booking";
  if (booking.status !== BookingStatus.CANCELLED) return "not_cancelled";

  let to = mirror.business.email;
  const ownerFallback = !to;
  if (!to) {
    const owner = await prisma.flowkoBusinessMember.findFirst({
      where: { businessId: mirror.businessId, role: FlowkoBusinessRole.OWNER },
      select: { user: { select: { email: true } } },
    });
    to = owner?.user?.email ?? null;
  }
  if (!to) return "no_recipient";

  const { timeZone } = mirror.business;
  const attendee = booking.attendees[0];
  const date = todayIn(timeZone, booking.startTime);
  return {
    to,
    replyTo: attendee && !isSmsCalEmail(attendee.email) ? attendee.email : null,
    customerName: attendee?.name ?? "",
    customerPhone: attendee?.phoneNumber || null,
    serviceNames: Array.from(new Set(booking.flowkoBookingSteps.map((step) => step.serviceName))),
    workerName: mirror.member.displayName,
    date: slInviteDate(date),
    start: formatHm(booking.startTime.getTime(), timeZone),
    end: formatHm(booking.endTime.getTime(), timeZone),
    reason: booking.cancellationReason || null,
    dayUrl: `${WEBAPP_URL}/koledar?view=day&date=${date}`,
    ownerFallback,
  };
}

/**
 * Flowko U29e: E7, R13 — the business notice after a customer's cancel has committed. Never throws: only "sent"
 * counts; any other outcome, a notice that cannot be built and any throw are logged once as
 * `flowko_cancel_notice_not_sent` with the booking id and the outcome or the error class only (never an address,
 * a name, the reason or the subject). Slovene.
 */
export async function sendBusinessCancelNotice(bookingId: number): Promise<void> {
  try {
    const args = await cancelNoticeArgs(bookingId);
    if (typeof args === "string") {
      log.warn("flowko_cancel_notice_not_sent", { bookingId, outcome: args });
      return;
    }
    const outcome = await sendFlowkoCancelNoticeEmail(args, "sl");
    if (outcome !== "sent") log.warn("flowko_cancel_notice_not_sent", { bookingId, outcome });
  } catch (error) {
    log.warn("flowko_cancel_notice_not_sent", {
      bookingId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
