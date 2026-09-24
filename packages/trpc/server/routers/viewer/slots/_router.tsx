import type { NextApiRequest, NextApiResponse } from "next";

import publicProcedure from "../../../procedures/publicProcedure";
import { router } from "../../../trpc";
import { ZIsAvailableInputSchema, ZIsAvailableOutputSchema } from "./isAvailable.schema";
import { ZRemoveSelectedSlotInputSchema } from "./removeSelectedSlot.schema";
import { ZReserveSlotInputSchema } from "./reserveSlot.schema";
import { ZGetScheduleInputSchema } from "./types";

type SlotsRouterHandlerCache = {
  getSchedule?: typeof import("./getSchedule.handler").getScheduleHandler;
  reserveSlot?: typeof import("./reserveSlot.handler").reserveSlotHandler;
  isAvailable?: typeof import("./isAvailable.handler").isAvailableHandler;
};

/** This should be called getAvailableSlots */
export const slotsRouter = router({
  getSchedule: publicProcedure.input(ZGetScheduleInputSchema).query(async ({ input, ctx }) => {
    const { getScheduleHandler } = await import("./getSchedule.handler");

    // Flowko: internal/debug flags are never honoured from this public procedure (U8c, AV-5).
    // _bypassCalendarBusyTimes let any visitor diff a tenant's slots with and without their
    // Google Calendar busy times, and _silentCalendarFailures showed whose calendar is broken.
    // The web booker never sends them (only the undeployed API v2 atoms do).
    const {
      _enableTroubleshooter: _ignoredEnableTroubleshooter,
      _bypassCalendarBusyTimes: _ignoredBypassCalendarBusyTimes,
      _silentCalendarFailures: _ignoredSilentCalendarFailures,
      ...publicInput
    } = input;

    return getScheduleHandler({
      ctx,
      input: publicInput,
    });
  }),
  reserveSlot: publicProcedure.input(ZReserveSlotInputSchema).mutation(async ({ input, ctx }) => {
    const { reserveSlotHandler } = await import("./reserveSlot.handler");

    return reserveSlotHandler({
      ctx: { ...ctx, req: ctx.req as NextApiRequest, res: ctx.res as NextApiResponse },
      input,
    });
  }),
  isAvailable: publicProcedure
    .input(ZIsAvailableInputSchema)
    .output(ZIsAvailableOutputSchema)
    .query(async ({ input, ctx }) => {
      const { isAvailableHandler } = await import("./isAvailable.handler");

      return isAvailableHandler({
        ctx: { ...ctx, req: ctx.req as NextApiRequest },
        input,
      });
    }),
  // This endpoint has no dependencies, it doesn't need its own file
  // Flowko: slot reservation is switched off (U8c, AV-2), so there is no reservation to release.
  // It deletes nothing: an anonymous caller could otherwise delete rows by any uid it names.
  removeSelectedSlotMark: publicProcedure.input(ZRemoveSelectedSlotInputSchema).mutation(async () => {
    return;
  }),
});
