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

// Flowko U29b (S7): confirm answers the booking count of a needs_confirm result.
export const ZAddAbsenceInput = z
  .object({
    memberId: idSchema,
    startDate: localDateSchema,
    endDate: localDateSchema,
    confirm: z.boolean().default(false),
  })
  .strict();
export type TAddAbsenceInput = z.infer<typeof ZAddAbsenceInput>;

export const ZRemoveAbsenceInput = z.object({ absenceId: idSchema }).strict();
export type TRemoveAbsenceInput = z.infer<typeof ZRemoveAbsenceInput>;

export const ZSetHolidaysClosedInput = z.object({ closed: z.boolean() }).strict();
export type TSetHolidaysClosedInput = z.infer<typeof ZSetHolidaysClosedInput>;

export const ZSetHolidayOpenInput = z.object({ date: localDateSchema, open: z.boolean() }).strict();
export type TSetHolidayOpenInput = z.infer<typeof ZSetHolidayOpenInput>;

// Flowko U29b (S3, S4, S17): the roster editor's all-or-nothing saves. `version` is the 64-char hex token the
// read gave (weekVersion / usualVersion); row rules (distinct ids, rights, 4 entries a day) live in the services.
const versionSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const ZSaveWeekInput = z
  .object({
    weekStart: localDateSchema,
    rows: z
      .array(z.object({ memberId: idSchema, version: versionSchema, days: weekPlanSchema }).strict())
      .min(1)
      .max(50),
    confirm: z.boolean().default(false),
  })
  .strict();
export type TSaveWeekInput = z.infer<typeof ZSaveWeekInput>;

export const ZSaveUsualWeeksInput = z
  .object({
    rows: z
      .array(
        z
          .object({ memberId: idSchema, version: versionSchema, usualWeek: weekHoursSchema.nullable() })
          .strict()
      )
      .min(1)
      .max(50),
    confirm: z.boolean().default(false),
  })
  .strict();
export type TSaveUsualWeeksInput = z.infer<typeof ZSaveUsualWeeksInput>;
