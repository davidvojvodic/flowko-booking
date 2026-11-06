import { FLOWKO_REMINDER_OFFSETS, flowkoRemindersSchema } from "@calcom/prisma/zod-utils";

const MINUTE_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Flowko U22: how long after its reminder moment a reminder may still go out. One constant for the sweep's query
 * and for `dueReminders`, so a booking the query selects is one `dueReminders` can call due. 60 minutes survive a
 * missed cron run or a release.
 */
export const REMINDER_LOOKBACK_MINUTES = 60;

export type ReminderCandidate = {
  startTime: Date;
  createdAt: Date;
  updatedAt: Date | null;
  eventTypeMetadata: unknown;
};

/**
 * Flowko U22 (R3): the offsets (minutes before the start) whose reminder is due now. A reminder is due when
 * `now ∈ [start − offset, start − offset + lookback)`, and the booking was neither made nor changed (e.g. confirmed)
 * after that moment: such a booking just got its confirmation. Only `metadata.flowkoReminders` is read, so an invalid
 * key elsewhere in the metadata does not switch reminders off. Absent, off or invalid → none (R1).
 */
export function dueReminders(
  booking: ReminderCandidate,
  now: Date,
  lookbackMinutes: number = REMINDER_LOOKBACK_MINUTES
): number[] {
  const metadata = booking.eventTypeMetadata;
  const parsed = flowkoRemindersSchema.safeParse(isRecord(metadata) ? metadata.flowkoReminders : undefined);
  if (!parsed.success || !parsed.data.enabled) return [];
  const { offsets } = parsed.data;

  const nowMs = now.getTime();
  return FLOWKO_REMINDER_OFFSETS.filter((offset) => {
    if (!offsets.includes(offset)) return false;
    const moment = booking.startTime.getTime() - offset * MINUTE_MS;
    if (nowMs < moment || nowMs >= moment + lookbackMinutes * MINUTE_MS) return false;
    if (booking.createdAt.getTime() > moment) return false;
    if (booking.updatedAt && booking.updatedAt.getTime() > moment) return false;
    return true;
  });
}

/** Flowko U22: `booking.responses.email` when it is a string. */
export function getResponsesEmail(responses: unknown): string | undefined {
  return isRecord(responses) && typeof responses.email === "string" ? responses.email : undefined;
}

/**
 * Flowko U22 (R4): the booker is the attendee whose e-mail is the booking form's e-mail (case-insensitive), else the
 * attendee with the lowest id. Attendee order is not guaranteed, so position is never used.
 */
export function pickBooker<T extends { id: number; email: string }>(
  attendees: T[],
  responsesEmail?: string
): T | undefined {
  if (responsesEmail) {
    const wanted = responsesEmail.toLowerCase();
    const match = attendees.find((attendee) => attendee.email.toLowerCase() === wanted);
    if (match) return match;
  }
  return attendees.reduce<T | undefined>(
    (lowest, attendee) => (!lowest || attendee.id < lowest.id ? attendee : lowest),
    undefined
  );
}
