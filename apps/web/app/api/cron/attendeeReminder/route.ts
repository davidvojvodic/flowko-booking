import process from "node:process";
import { sendAttendeeReminderEmail } from "@calcom/emails/email-manager";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { CalendarEventBuilder } from "@calcom/features/CalendarEventBuilder";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import {
  dueCandidatesWhere,
  dueReminders,
  getResponsesEmail,
  pickBooker,
} from "@lib/flowko/attendeeReminders";
import { isAuthorizedCron } from "@lib/flowko/cronAuth";
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Flowko U22: the booker's reminder e-mail, 24 h and/or 2 h before an accepted booking (per service,
 * `EventType.metadata.flowkoReminders`). A Railway cron service POSTs this every 5 minutes.
 *
 * Never twice: each (booking, offset) is claimed in FlowkoAttendeeReminder (unique key) before the mail goes out;
 * a lost claim race means another run has it. A refused send (or the kill switch at send time) releases the claim,
 * so the next run retries within the lookback. Logs and the response carry counts only (prod data rule).
 */
const log = logger.getSubLogger({ prefix: ["[api/cron/attendeeReminder]"] });

const MAX_BOOKINGS_PER_RUN = 200;

type Outcome = "sent" | "failed" | "skipped";

/** The error's class and Prisma/transport code only: messages can carry the booking uid or the recipient. */
const loggableError = (error: unknown) => {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return {
    errorClass: typeof name === "string" ? name : typeof error,
    ...(typeof code === "string" && { code }),
  };
};

const selectDueCandidates = (now: Date) =>
  prisma.booking.findMany({
    where: dueCandidatesWhere(now),
    select: {
      id: true,
      startTime: true,
      createdAt: true,
      updatedAt: true,
      responses: true,
      eventType: { select: { id: true, title: true, eventName: true, metadata: true } },
      attendees: {
        select: { id: true, email: true, name: true, timeZone: true, locale: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { startTime: "asc" },
    take: MAX_BOOKINGS_PER_RUN,
  });

type Candidate = Awaited<ReturnType<typeof selectDueCandidates>>[number];

async function remindOnce(
  candidate: Candidate & { eventType: NonNullable<Candidate["eventType"]> },
  bookerEmail: string,
  offsetMinutes: number,
  bookingRepository: BookingRepository
): Promise<Outcome> {
  const { eventType } = candidate;
  // Full parse only for the attendee opt-out (disableStandardEmails): unreadable metadata means it cannot be
  // honoured, so nothing is sent and nothing is claimed.
  const parsedMetadata = EventTypeMetaDataSchema.safeParse(eventType.metadata);
  if (!parsedMetadata.success) return "skipped";

  const claim = { bookingId: candidate.id, offsetMinutes };
  let claimed = false;
  try {
    const { count } = await prisma.flowkoAttendeeReminder.createMany({ data: [claim], skipDuplicates: true });
    if (count !== 1) return "skipped"; // another run holds this claim
    claimed = true;

    const booking = await bookingRepository.getBookingForCalEventBuilder(candidate.id);
    if (!booking) throw new Error("Booking not found");
    const built = (await CalendarEventBuilder.fromBooking(booking)).build();

    // Built Person objects carry no id: match the booker by e-mail. The template treats attendees[0] as the booker
    // (manage links, the rebuilt title, the time line).
    const wanted = bookerEmail.toLowerCase();
    const booker = built.attendees.find((attendee) => attendee.email.toLowerCase() === wanted);
    if (!booker) throw new Error("Booker not among the built attendees");
    const calEvent = {
      ...built,
      type: eventType.title, // fromBooking sets the slug; the subject wants the service's name
      attendees: [booker, ...built.attendees.filter((attendee) => attendee !== booker)],
    };
    const result = await sendAttendeeReminderEmail(
      calEvent,
      booker,
      { eventType: eventType.title, eventName: eventType.eventName },
      parsedMetadata.data
    );
    if (result === "sent") return "sent";
    if (result === "skipped_kill_switch") {
      await prisma.flowkoAttendeeReminder.deleteMany({ where: claim });
      return "failed";
    }
    // Disabled for attendees, faux address, test mode: the claim stays, so it is not retried.
    return "skipped";
  } catch (error) {
    log.error("reminder not sent", loggableError(error));
    if (claimed) {
      try {
        await prisma.flowkoAttendeeReminder.deleteMany({ where: claim });
      } catch (releaseError) {
        log.error("claim not released", loggableError(releaseError));
      }
    }
    return "failed";
  }
}

async function postHandler(request: NextRequest) {
  if (!isAuthorizedCron(request, process.env.FLOWKO_REMINDER_CRON_SECRET)) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  // The same global kill switch BaseEmail checks: nothing claimed while e-mails are off.
  if (await new FeaturesRepository(prisma).checkIfFeatureIsEnabledGlobally("emails")) {
    log.info("skipped: emails off");
    return NextResponse.json({ skipped: "emails-off" });
  }

  const now = new Date();
  const candidates = await selectDueCandidates(now);
  const bookingRepository = new BookingRepository(prisma);
  const counts = { due: 0, sent: 0, failed: 0, skipped: 0 };

  for (const candidate of candidates) {
    const { eventType } = candidate;
    if (!eventType) continue;
    const offsets = dueReminders(
      {
        startTime: candidate.startTime,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        eventTypeMetadata: eventType.metadata,
      },
      now
    );
    if (offsets.length === 0) continue;
    counts.due += offsets.length;

    const booker = pickBooker(candidate.attendees, getResponsesEmail(candidate.responses));
    for (const offset of offsets) {
      if (!booker) {
        counts.skipped++;
        continue;
      }
      counts[await remindOnce({ ...candidate, eventType }, booker.email, offset, bookingRepository)]++;
    }
  }

  log.info("attendee reminders", counts);
  return NextResponse.json(counts);
}

export const POST = defaultResponderForAppDir(postHandler);
