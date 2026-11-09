// Flowko U25: the rules a business profile must meet (opening hours per weekday, service steps, brand colours,
// contact fields, slot grid, self-cancel window, time zone) and the bridge from opening hours to the U24 engine's
// DayRules.opening. Pure and client-safe: imports only zod and the pure U24 engine; no `node:` import here.
// Custom refinements report codes, never the submitted values; zod's default messages for enum/strict may name
// the submitted value or key, so callers map any failure to bad_profile.
import type { Interval, LocalDate, ServiceStep } from "@calcom/lib/flowkoSalon";
import { localInterval, totalMinutes, validateSteps, wallClockToMs } from "@calcom/lib/flowkoSalon";
import { z } from "zod";
// Flowko U29a: the placeholder-address check (client-safe, no module reference beyond ./flowkoBusiness/deskEmail).
import isSmsCalEmail from "../isSmsCalEmail";
import { isFlowkoSlugShape } from "./name";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type OpeningHoursEntry = { from: string; to: string };
export type OpeningHours = Record<Weekday, OpeningHoursEntry[]>;

/** "HH:mm" with a two-digit hour, or "24:00" (end of day only). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/**
 * Earliest opening time. EU DST moves the clock at 02:00 (spring: 02:00-03:00 does not exist) and at 03:00
 * (autumn: 02:00-03:00 happens twice), so from 03:00 on a wall-clock time maps to exactly one instant.
 * This assumes EU DST (Ruling 14): accepted for U25, where every business runs in Europe/Ljubljana;
 * revisit before allowing a time zone with a different change hour.
 */
const OPENING_FLOOR = "03:00";

/** Minutes since midnight of an "HH:mm" (or "24:00") time. */
function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const openingEntrySchema = z
  .object({
    from: z.string().regex(TIME_RE, { message: "time_format" }),
    to: z.string().regex(TIME_RE, { message: "time_format" }),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.from === "24:00")
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "start_at_24", path: ["from"] });
    if (minutesOf(entry.from) < minutesOf(OPENING_FLOOR)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "before_03_00", path: ["from"] });
    }
    if (minutesOf(entry.to) <= minutesOf(entry.from)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "end_not_after_start", path: ["to"] });
    }
  });

// Flowko U26: exported (renamed, no rule change) so the roster layer reuses the same day rule.
export const shiftDaySchema = z.array(openingEntrySchema).superRefine((entries, ctx) => {
  for (let i = 1; i < entries.length; i++) {
    // Sorted and non-overlapping; touching (12:00-12:00) is allowed, intervals are half-open.
    if (minutesOf(entries[i].from) < minutesOf(entries[i - 1].to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unsorted_or_overlapping", path: [i] });
    }
  }
});

/** All seven weekdays, each a sorted, non-overlapping list of "HH:mm" intervals within 03:00-24:00 (P14). */
export const openingHoursSchema: z.ZodType<OpeningHours> = z
  .object({
    mon: shiftDaySchema,
    tue: shiftDaySchema,
    wed: shiftDaySchema,
    thu: shiftDaySchema,
    fri: shiftDaySchema,
    sat: shiftDaySchema,
    sun: shiftDaySchema,
  })
  .strict();

/** A service's steps; the U24 validateSteps() codes become the issue messages. */
export const serviceStepsSchema: z.ZodType<ServiceStep[]> = z
  .array(z.object({ kind: z.enum(["busy", "processing"]), minutes: z.number() }).strict())
  .superRefine((steps, ctx) => {
    for (const code of validateSteps(steps)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: code });
  });

/** "#abc" or "#aabbcc" in any case; stored as lowercase "#rrggbb" (P14, SQL CHECK). */
export const brandColorSchema: z.ZodType<string> = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, { message: "color_format" })
  .transform((value) => {
    const hex = value.slice(1).toLowerCase();
    return hex.length === 3 ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}` : `#${hex}`;
  });

export const SLOT_GRIDS = [5, 10, 15, 20, 30, 60] as const;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** An IANA zone name the runtime knows ("Europe/Ljubljana", "UTC"); offsets like "+01:00" are refused. */
function isIanaTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The editable business profile. darkBrandColor null means "use brandColor" (resolved at read time).
 * Nullable fields must be given explicitly (null), so a caller never stores a field by omission.
 */
export const businessProfileSchema = z.object({
  name: z.string().trim().min(1, { message: "name_length" }).max(80, { message: "name_length" }),
  slug: z.string().refine(isFlowkoSlugShape, { message: "slug_format" }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()/-]{6,20}$/, { message: "phone_format" })
    .nullable(),
  address: z
    .string()
    .trim()
    .min(1, { message: "address_length" })
    .max(200, { message: "address_length" })
    .nullable(),
  websiteUrl: z.string().trim().refine(isHttpsUrl, { message: "website_https" }).nullable(),
  instagramHandle: z
    .string()
    .regex(/^[A-Za-z0-9._]{1,30}$/, { message: "instagram_format" })
    .nullable(),
  brandColor: brandColorSchema.nullable(),
  darkBrandColor: brandColorSchema.nullable(),
  openingHours: openingHoursSchema,
  slotGridMinutes: z
    .number()
    .int()
    .refine((n) => (SLOT_GRIDS as readonly number[]).includes(n), { message: "slot_grid" }),
  showPrices: z.boolean(),
  selfCancelHours: z
    .number()
    .int()
    .min(0, { message: "self_cancel_range" })
    .max(168, { message: "self_cancel_range" }),
  timeZone: z.string().refine(isIanaTimeZone, { message: "time_zone" }),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

/** getUTCDay() order: 0 = Sunday. */
const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * The opening intervals of `date` in `timeZone`, one per entry of that weekday, in order (= DayRules.opening for
 * the U24 engine; used by U26/U27). Expects validated hours. Throws RangeError on a malformed date or zone,
 * also on a closed day.
 */
export function openingIntervalsFor(hours: OpeningHours, date: LocalDate, timeZone: string): Interval[] {
  wallClockToMs(date, "00:00", timeZone); // validates date and zone even when the day is closed
  const weekday = WEEKDAY_BY_UTC_DAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return hours[weekday].map((entry) => localInterval(date, entry.from, entry.to, timeZone));
}

// Flowko U29a: the owner's settings form (S1, S2, S5) and the service editor (S8, S9). Messages are codes, never
// the submitted values; callers map any failure to bad_profile (settings) or bad_service (services).

/** Control characters; refused in names and addresses (they reach the From name, titles, subjects and the ICS). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f]/;

function hasNoControlCharacter(value: string): boolean {
  return !CONTROL_CHARACTER_RE.test(value);
}

/**
 * The reminder e-mail choices (U22): minutes before the booking, in the one canonical order the database CHECK
 * allows. [] = no reminder. Each reminder is one e-mail per booking.
 */
export const REMINDER_CHOICES = [
  { id: "none", offsets: [] },
  { id: "day_before", offsets: [1440] },
  { id: "two_hours_before", offsets: [120] },
  { id: "day_and_two_hours_before", offsets: [1440, 120] },
] as const satisfies readonly { id: string; offsets: readonly number[] }[];
export type ReminderChoiceId = (typeof REMINDER_CHOICES)[number]["id"];

/** Today's behaviour and the column default: one reminder 24 hours before. */
export const DEFAULT_REMINDER_OFFSETS: readonly number[] = [1440];

/** Flowko U29a: true when the offsets are exactly one of REMINDER_CHOICES (the API edge and the service share it). */
export function isReminderChoice(offsets: readonly number[]): boolean {
  return REMINDER_CHOICES.some(
    (choice) =>
      choice.offsets.length === offsets.length &&
      choice.offsets.every((offset, index) => offset === offsets[index])
  );
}

const profileShape = businessProfileSchema.shape;

/**
 * The business settings the owner edits (S2). Slug and time zone are not editable. Phone is required (since U27 a
 * customer reschedules by calling); the e-mail is optional and never a placeholder address; at least one weekday
 * must be open.
 */
export const businessSettingsSchema = z.object({
  name: profileShape.name.refine(hasNoControlCharacter, { message: "control_character" }),
  phone: z
    .string({ required_error: "phone_required", invalid_type_error: "phone_required" })
    .trim()
    .min(1, { message: "phone_required" })
    .pipe(profileShape.phone.unwrap()),
  address: profileShape.address
    .unwrap()
    .refine(hasNoControlCharacter, { message: "control_character" })
    .nullable(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message: "email_length" })
    .email({ message: "email_format" })
    .refine((email) => !isSmsCalEmail(email), { message: "email_placeholder" })
    .nullable(),
  openingHours: openingHoursSchema.superRefine((hours, ctx) => {
    if (WEEKDAYS.every((day) => hours[day].length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "no_open_day" });
    }
  }),
  slotGridMinutes: profileShape.slotGridMinutes,
  holidaysClosed: z.boolean(),
  reminderOffsets: z.array(z.number().int()).refine(isReminderChoice, { message: "reminder_offsets" }),
  sharedDevice: z.boolean(),
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

/** Caps on a service a save may store (S9); stored services are never re-validated against them. */
export const SERVICE_LIMITS = {
  nameMax: 60,
  categoryMax: 40,
  stepsMax: 8,
  stepMinutesMin: 5,
  stepMinutesMax: 480,
  stepMinutesMultiple: 5,
  totalMinutesMax: 720,
} as const;

/**
 * A service as the editor saves it (S8, S9, S14): the U24 step rules plus the caps (step count, minutes per step,
 * total). category: trimmed, empty → null. workerMemberIds: who does it (positive ids, each once; the server
 * checks they are ACTIVE column members of the business).
 */
export const serviceInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z
    .string()
    .trim()
    .min(1, { message: "name_length" })
    .max(SERVICE_LIMITS.nameMax, { message: "name_length" })
    .refine(hasNoControlCharacter, { message: "control_character" }),
  category: z
    .string()
    .trim()
    .max(SERVICE_LIMITS.categoryMax, { message: "category_length" })
    .refine(hasNoControlCharacter, { message: "control_character" })
    .transform((category) => (category === "" ? null : category))
    .nullable(),
  steps: serviceStepsSchema.superRefine((steps, ctx) => {
    if (steps.length > SERVICE_LIMITS.stepsMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "too_many_steps" });
    }
    steps.forEach((step, index) => {
      if (step.minutes > SERVICE_LIMITS.stepMinutesMax) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `step_too_long:${index}`, path: [index] });
      }
    });
    if (totalMinutes(steps) > SERVICE_LIMITS.totalMinutesMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "total_too_long" });
    }
  }),
  workerMemberIds: z
    .array(z.number().int().positive({ message: "bad_member" }))
    .refine((ids) => new Set(ids).size === ids.length, { message: "bad_member" }),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;
