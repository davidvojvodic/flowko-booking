// Flowko U29a: strict input shape of viewer.flowko.business.updateSettings (S2, S14). Shapes and generous size caps
// only, plus the reminder choice (REMINDER_CHOICES): the field rules (name, phone, address, e-mail, opening hours,
// slot grid) live in businessSettingsSchema, which settings.ts applies, so a refused value answers bad_profile
// rather than a zod message. Slug and time zone are not editable, so they are not keys here. The actor is always
// ctx.user.id.
import { REMINDER_CHOICES } from "@calcom/lib/flowkoBusiness";
import { z } from "zod";

/** Early 400 for an oversized payload; generous so an untrimmed value still reaches the service's rule. */
const TEXT_MAX = 500;
/** Opening intervals per weekday: a cap against junk only; the interval rules are the service's. */
const DAY_ENTRIES_MAX = 24;

const openingEntrySchema = z.object({ from: z.string().max(5), to: z.string().max(5) }).strict();
const openingDaySchema = z.array(openingEntrySchema).max(DAY_ENTRIES_MAX);
const openingHoursShape = z
  .object({
    mon: openingDaySchema,
    tue: openingDaySchema,
    wed: openingDaySchema,
    thu: openingDaySchema,
    fri: openingDaySchema,
    sat: openingDaySchema,
    sun: openingDaySchema,
  })
  .strict();

function isReminderChoice(offsets: number[]): boolean {
  return REMINDER_CHOICES.some(
    (choice) =>
      choice.offsets.length === offsets.length &&
      choice.offsets.every((offset, index) => offset === offsets[index])
  );
}

export const ZUpdateSettingsInput = z
  .object({
    name: z.string().max(TEXT_MAX),
    phone: z.string().max(TEXT_MAX),
    address: z.string().max(TEXT_MAX).nullable(),
    email: z.string().max(TEXT_MAX).nullable(),
    openingHours: openingHoursShape,
    slotGridMinutes: z.number().int(),
    holidaysClosed: z.boolean(),
    reminderOffsets: z.array(z.number().int()).max(2).refine(isReminderChoice),
    sharedDevice: z.boolean(),
    // superjson carries the Date the form loaded (business.settings' updatedAt); an invalid Date is refused.
    expectedUpdatedAt: z.date(),
    confirm: z.boolean().default(false),
  })
  .strict();
export type TUpdateSettingsInput = z.infer<typeof ZUpdateSettingsInput>;
