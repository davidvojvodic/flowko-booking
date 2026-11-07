// Flowko U26: strict input shapes for viewer.flowko.roster.*. The services trust input shape, so every schema pins it
// exactly. Calendar rules (Monday, window, opening cap) stay in the services.
import { localDateSchema, weekHoursSchema, weekPlanSchema } from "@calcom/lib/flowkoBusiness";
import { z } from "zod";

const MAX_INT4 = 2147483647;
const idSchema = z.number().int().positive().max(MAX_INT4);

export const ZRosterWeekInput = z.object({ weekStart: localDateSchema }).strict();
export type TRosterWeekInput = z.infer<typeof ZRosterWeekInput>;

export const ZSetUsualWeekInput = z
  .object({
    memberId: idSchema,
    usualWeek: weekHoursSchema.nullable(),
    confirmOutsideOpening: z.boolean().default(false),
  })
  .strict();
export type TSetUsualWeekInput = z.infer<typeof ZSetUsualWeekInput>;

export const ZSetWeekInput = z
  .object({
    memberId: idSchema,
    weekStart: localDateSchema,
    days: weekPlanSchema,
    confirmOutsideOpening: z.boolean().default(false),
  })
  .strict();
export type TSetWeekInput = z.infer<typeof ZSetWeekInput>;

export const ZCopyWeekInput = z
  .object({
    fromWeekStart: localDateSchema,
    toWeekStart: localDateSchema,
    memberIds: z.array(idSchema).max(50).nullable(),
  })
  .strict();
export type TCopyWeekInput = z.infer<typeof ZCopyWeekInput>;

export const ZAddAbsenceInput = z
  .object({ memberId: idSchema, startDate: localDateSchema, endDate: localDateSchema })
  .strict();
export type TAddAbsenceInput = z.infer<typeof ZAddAbsenceInput>;

export const ZRemoveAbsenceInput = z.object({ absenceId: idSchema }).strict();
export type TRemoveAbsenceInput = z.infer<typeof ZRemoveAbsenceInput>;

export const ZSetHolidaysClosedInput = z.object({ closed: z.boolean() }).strict();
export type TSetHolidaysClosedInput = z.infer<typeof ZSetHolidaysClosedInput>;

export const ZSetHolidayOpenInput = z.object({ date: localDateSchema, open: z.boolean() }).strict();
export type TSetHolidayOpenInput = z.infer<typeof ZSetHolidayOpenInput>;
