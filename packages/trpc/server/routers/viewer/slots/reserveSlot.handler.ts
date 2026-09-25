import type { NextApiRequest, NextApiResponse } from "next";
import { v4 as uuid } from "uuid";

import type { PrismaClient } from "@calcom/prisma";

import type { TReserveSlotInputSchema } from "./reserveSlot.schema";

interface ReserveSlotOptions {
  ctx: {
    prisma: PrismaClient;
    req?: NextApiRequest | undefined;
    res?: NextApiResponse | undefined;
  };
  input: TReserveSlotInputSchema;
}

/**
 * Flowko: slot reservation is switched off (U8c, AV-2). This public mutation used to write a
 * SelectedSlots row per host for any caller-supplied time range, and getSchedule dropped every
 * overlapping slot of that host across all their event types, so one anonymous request could
 * empty a tenant's booking pages. It now writes nothing (no row, no cookie) and returns only a
 * fresh uid, which is all the booker uses (it gates the isAvailable quick check on it).
 * handleNewBooking's own availability check stays the double-booking guard.
 */
export const reserveSlotHandler = async (_options: ReserveSlotOptions) => {
  return {
    uid: uuid(),
  };
};
