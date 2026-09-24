import type { NextApiRequest } from "next";

import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { HttpError } from "@calcom/lib/http-error";
import { getPastTimeAndMinimumBookingNoticeBoundsStatus } from "@calcom/lib/isOutOfBounds";
import type { PrismaClient } from "@calcom/prisma";

import type { TIsAvailableInputSchema, TIsAvailableOutputSchema } from "./isAvailable.schema";

interface IsAvailableOptions {
  ctx: {
    prisma: PrismaClient;
    req?: NextApiRequest | undefined;
  };
  input: TIsAvailableInputSchema;
}

/**
 * It does a super quick check whether that slot is bookable or not.
 * It doesn't consider slow things like querying the bookings, checking the calendars.
 *
 * getSchedule call is the only(but very slow) way to know if a slot is bookable
 */
export const isAvailableHandler = async ({
  ctx,
  input,
}: IsAvailableOptions): Promise<TIsAvailableOutputSchema> => {
  const { slots, eventTypeId } = input;

  // Get event type details for time bounds validation
  const eventTypeRepo = new EventTypeRepository(ctx.prisma);
  const eventType = await eventTypeRepo.findByIdMinimal({ id: eventTypeId });

  if (!eventType) {
    throw new HttpError({ statusCode: 404, message: "Event type not found" });
  }

  // Flowko: slot reservation is switched off (U8c, AV-2), so another uid's SelectedSlots row is
  // never read here. It never refused a slot (reserved slots were reported as available), but
  // realStatus: "reserved" told any caller that someone else was booking that slot.
  const slotsWithStatus: TIsAvailableOutputSchema["slots"] = slots.map((slot) => {
    // Check time bounds
    const timeStatus = getPastTimeAndMinimumBookingNoticeBoundsStatus({
      time: slot.utcStartIso,
      minimumBookingNotice: eventType.minimumBookingNotice,
    });

    return {
      ...slot,
      status: timeStatus.reason ?? "available",
    };
  });

  return {
    slots: slotsWithStatus,
  };
};
