// Flowko U25: the rules a business profile must meet (opening hours per weekday, service steps, brand colours,
// contact fields, slot grid, self-cancel window, time zone) and the bridge from opening hours to the U24 engine's
// DayRules.opening. Pure and client-safe: imports only zod and the pure U24 engine; no `node:` import here.
// Issue messages are codes, never the submitted values.
import type { Interval, LocalDate, ServiceStep } from "@calcom/lib/flowkoSalon";
import { localInterval, validateSteps, wallClockToMs } from "@calcom/lib/flowkoSalon";
import { z } from "zod";
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

const openingDaySchema = z.array(openingEntrySchema).superRefine((entries, ctx) => {
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
    mon: openingDaySchema,
    tue: openingDaySchema,
    wed: openingDaySchema,
    thu: openingDaySchema,
    fri: openingDaySchema,
    sat: openingDaySchema,
    sun: openingDaySchema,
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
