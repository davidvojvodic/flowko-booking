import { IS_SEATS_AND_RECURRING_ENABLED } from "@calcom/lib/constants";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { Prisma } from "@calcom/prisma/client";
import { TRPCError } from "@trpc/server";

/**
 * Flowko: seated and recurring event types are off on this instance (IS_SEATS_AND_RECURRING_ENABLED), so
 * an event type write that would turn on seats or a recurring series is refused. Turning either off (null,
 * or Prisma's DbNull or JsonNull for recurringEvent) stays allowed.
 */
export function ensureNotSeatedOrRecurring({
  seatsPerTimeSlot,
  recurringEvent,
}: {
  seatsPerTimeSlot?: number | null;
  recurringEvent?: unknown;
}) {
  if (IS_SEATS_AND_RECURRING_ENABLED) return;

  const isRecurring =
    recurringEvent !== undefined &&
    recurringEvent !== null &&
    recurringEvent !== Prisma.DbNull &&
    recurringEvent !== Prisma.JsonNull;
  if (seatsPerTimeSlot || isRecurring) {
    throw new TRPCError({ code: "BAD_REQUEST", message: ErrorCode.SeatsAndRecurringNotAvailable });
  }
}
