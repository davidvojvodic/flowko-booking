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
        // Flowko U28 (R17): early 400 instead of a lookup first
        name: z.string().max(80),
        email: z.string().max(254).nullish(),
        phone: z.string().max(32).nullish(),
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

// Flowko U28: the desk's reads and its no-show write. Dates are real calendar dates (localDateSchema); the week must
// start on a Monday, which the service checks (bad_roster).
export const ZDayInput = z.object({ date: localDateSchema }).strict();
export type TDayInput = z.infer<typeof ZDayInput>;

export const ZWeekInput = z.object({ weekStart: localDateSchema, memberId: idSchema }).strict();
export type TWeekInput = z.infer<typeof ZWeekInput>;

export const ZCustomersInput = z.object({ query: z.string().trim().min(1).max(80) }).strict();
export type TCustomersInput = z.infer<typeof ZCustomersInput>;

export const ZNoShowInput = z
  .object({ bookingId: idSchema, noShow: z.boolean(), actorMemberId: actorMemberIdSchema })
  .strict();
export type TNoShowInput = z.infer<typeof ZNoShowInput>;
