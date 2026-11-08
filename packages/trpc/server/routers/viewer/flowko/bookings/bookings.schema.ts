// Flowko U27: strict input shapes for viewer.flowko.bookings.*. The services trust input shape, so every schema pins it
// exactly. Opening hours, roster, notice and fit rules stay in the services; the actor is always ctx.user.id.
import { localDateSchema } from "@calcom/lib/flowkoBusiness";
import { z } from "zod";

const MAX_INT4 = 2147483647;
const idSchema = z.number().int().positive().max(MAX_INT4);
const serviceIdsSchema = z.array(idSchema).min(1).max(5);
// UTC ISO instant ("...Z", the client sends toISOString()); an offset or a local "2026-11-16 09:00" is refused.
const startSchema = z.string().datetime();
const actorMemberIdSchema = idSchema.nullish();

export const ZFreeStartsInput = z.object({ date: localDateSchema, serviceIds: serviceIdsSchema }).strict();
export type TFreeStartsInput = z.infer<typeof ZFreeStartsInput>;

export const ZCreateBookingInput = z
  .object({
    workerMemberId: idSchema,
    serviceIds: serviceIdsSchema,
    start: startSchema,
    customer: z
      .object({
        name: z.string(),
        email: z.string().nullish(),
        phone: z.string().nullish(),
      })
      .strict(),
    confirmOverride: z.boolean().default(false),
    actorMemberId: actorMemberIdSchema,
  })
  .strict();
export type TCreateBookingInput = z.infer<typeof ZCreateBookingInput>;

export const ZCancelBookingInput = z
  .object({
    bookingId: idSchema,
    reason: z.string().max(500).nullish(),
    actorMemberId: actorMemberIdSchema,
  })
  .strict();
export type TCancelBookingInput = z.infer<typeof ZCancelBookingInput>;

export const ZMoveBookingInput = z
  .object({
    bookingId: idSchema,
    start: startSchema,
    confirmOverride: z.boolean().default(false),
    actorMemberId: actorMemberIdSchema,
  })
  .strict();
export type TMoveBookingInput = z.infer<typeof ZMoveBookingInput>;
