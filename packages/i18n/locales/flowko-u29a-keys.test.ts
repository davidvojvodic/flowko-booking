// Flowko U29a: every string key the business settings section added (Tasks 6, 7a and 8) exists in en and sl
// with the same {{placeholders}}, no value is empty, and every {{count}} string is an i18next plural with all
// its forms (sl _one, _two, _few, _other; en _one, _other). The test checks keys, forms and placeholders, not
// texts: the Slovene wording may change. U29a added no flowko_desk_* key (flowko-u28-keys.test.ts pins those).
import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

// Base keys (plural suffix stripped), in file order; the list is exactly the U29a diff of the two locale files.
const U29A_KEYS = [
  // Task 6: the „Podjetje“ settings section and its two pages (S15).
  "flowko_settings_section",
  "flowko_settings_profile",
  "flowko_settings_profile_description",
  "flowko_settings_services",
  "flowko_settings_services_description",
  // Task 7a: the business profile page (S2, S3, S5, S16, S17).
  "flowko_settings_name",
  "flowko_settings_name_hint",
  "flowko_settings_phone",
  "flowko_settings_phone_hint",
  "flowko_settings_address",
  "flowko_settings_email",
  "flowko_settings_email_hint",
  "flowko_settings_call_page",
  "flowko_settings_call_page_hint",
  "flowko_settings_opening_hours",
  "flowko_settings_opening_hours_hint",
  "flowko_settings_closed",
  "flowko_settings_add_range",
  "flowko_settings_copy_to_all",
  "flowko_settings_range_from",
  "flowko_settings_range_to",
  "flowko_settings_range_remove",
  "flowko_settings_slot_grid",
  "flowko_settings_slot_grid_hint",
  "flowko_settings_slot_grid_option",
  "flowko_settings_holidays_closed",
  "flowko_settings_holidays_closed_hint",
  "flowko_settings_reminders",
  "flowko_settings_reminder_none",
  "flowko_settings_reminder_day_before",
  "flowko_settings_reminder_two_hours_before",
  "flowko_settings_reminder_day_and_two_hours_before",
  "flowko_settings_reminders_hint",
  "flowko_settings_shared_device",
  "flowko_settings_shared_device_hint",
  "flowko_settings_saved",
  "flowko_settings_changed_notice",
  "flowko_settings_load_error",
  "flowko_settings_error_forbidden",
  "flowko_settings_error_bad_profile",
  "flowko_settings_error_TOO_MANY_REQUESTS",
  "flowko_settings_outside_title",
  "flowko_settings_outside_body",
  "flowko_settings_outside_shifts",
  "flowko_settings_outside_bookings",
  "flowko_settings_outside_unchanged",
  "flowko_settings_outside_save",
  "flowko_settings_field_name_length",
  "flowko_settings_field_control_character",
  "flowko_settings_field_phone_required",
  "flowko_settings_field_phone_format",
  "flowko_settings_field_address_length",
  "flowko_settings_field_email_length",
  "flowko_settings_field_email_format",
  "flowko_settings_field_email_placeholder",
  "flowko_settings_field_no_open_day",
  "flowko_settings_field_time_format",
  "flowko_settings_field_start_at_24",
  "flowko_settings_field_before_03_00",
  "flowko_settings_field_end_not_after_start",
  "flowko_settings_field_unsorted_or_overlapping",
  "flowko_settings_field_slot_grid",
  "flowko_settings_field_reminder_offsets",
  "flowko_settings_field_invalid",
  // Task 8: the services page (S8 to S13).
  "flowko_settings_service_new",
  "flowko_settings_services_empty_title",
  "flowko_settings_services_empty_body",
  "flowko_settings_services_load_error",
  "flowko_settings_service_minutes",
  "flowko_settings_service_nobody",
  "flowko_settings_service_edit",
  "flowko_settings_service_edit_label",
  "flowko_settings_service_move_up",
  "flowko_settings_service_move_down",
  "flowko_settings_service_order_changed",
  "flowko_settings_service_title_edit",
  "flowko_settings_service_name",
  "flowko_settings_service_category",
  "flowko_settings_service_category_hint",
  "flowko_settings_service_steps",
  "flowko_settings_service_steps_hint",
  "flowko_settings_service_steps_rules",
  "flowko_settings_service_step_busy",
  "flowko_settings_service_step_processing",
  "flowko_settings_service_step_kind",
  "flowko_settings_service_step_minutes",
  "flowko_settings_service_step_up",
  "flowko_settings_service_step_down",
  "flowko_settings_service_step_remove",
  "flowko_settings_service_step_add",
  "flowko_settings_service_total",
  "flowko_settings_service_workers",
  "flowko_settings_service_workers_none_hint",
  "flowko_settings_service_workers_locked_hint",
  "flowko_settings_service_workers_empty",
  "flowko_settings_service_future_bookings",
  "flowko_settings_service_saved",
  "flowko_settings_service_removed",
  "flowko_settings_service_remove",
  "flowko_settings_service_remove_title",
  "flowko_settings_service_remove_bookings",
  "flowko_settings_service_remove_no_bookings",
  "flowko_settings_service_remove_final",
  "flowko_settings_service_error_bad_service",
  "flowko_settings_service_error_bad_member",
  "flowko_settings_service_error_service_name_taken",
  "flowko_settings_service_field_name_length",
  "flowko_settings_service_field_category_length",
  "flowko_settings_service_field_empty",
  "flowko_settings_service_field_no_busy_step",
  "flowko_settings_service_field_starts_with_processing",
  "flowko_settings_service_field_ends_with_processing",
  "flowko_settings_service_field_bad_minutes",
  "flowko_settings_service_field_step_too_long",
  "flowko_settings_service_field_too_many_steps",
  "flowko_settings_service_field_total_too_long",
  // Flowko U29b (Task 1a): U29a polish, per-day „Dodaj“ name and the service-gone text.
  "flowko_settings_add_range_day",
  "flowko_settings_service_error_gone",
  // Flowko U29c (Task 1b): the checked refresh after a save (P1) and the broken service row (P4).
  "flowko_settings_refresh_failed",
  "flowko_settings_refresh",
  "flowko_settings_service_broken",
];

// The {{count}} strings: stored only as plural forms, never under the base key.
const PLURAL_KEYS = [
  "flowko_settings_outside_shifts",
  "flowko_settings_outside_bookings",
  "flowko_settings_service_future_bookings",
  "flowko_settings_service_remove_bookings",
];

const EN_FORMS = ["one", "other"];
const SL_FORMS = ["one", "two", "few", "other"];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const SINGLE_KEYS = U29A_KEYS.filter((key) => !PLURAL_KEYS.includes(key));

const placeholders = (text: string): string[] =>
  Array.from(new Set(Array.from(text.matchAll(/{{\s*(\w+)\s*}}/g), (m) => m[1]))).sort();

const formsIn = (keys: Record<string, string>, base: string): string[] =>
  Object.keys(keys)
    .filter((key) => key.startsWith(`${base}_`) && PLURAL_SUFFIX.test(key) && key.replace(PLURAL_SUFFIX, "") === base)
    .map((key) => key.slice(base.length + 1))
    .sort();

const isFilled = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const baseKeysInFile = (keys: Record<string, string>): string[] =>
  Array.from(
    new Set(
      Object.keys(keys)
        .filter((key) => key.startsWith("flowko_settings_"))
        .map((key) => key.replace(PLURAL_SUFFIX, ""))
    )
  );

describe("U29a settings keys", () => {
  it("lists each key once and every plural key is in the list", () => {
    expect(new Set(U29A_KEYS).size).toBe(U29A_KEYS.length);
    expect(PLURAL_KEYS.filter((key) => !U29A_KEYS.includes(key))).toEqual([]);
  });

  it.each(SINGLE_KEYS)("%s exists in en and sl, not empty, with no plural forms", (key) => {
    expect(isFilled(enKeys[key])).toBe(true);
    expect(isFilled(slKeys[key])).toBe(true);
    expect(formsIn(enKeys, key)).toEqual([]);
    expect(formsIn(slKeys, key)).toEqual([]);
  });

  it.each(SINGLE_KEYS)("%s has the same placeholders in en and sl", (key) => {
    expect(placeholders(slKeys[key])).toEqual(placeholders(enKeys[key]));
  });

  it.each(PLURAL_KEYS)("%s has every plural form (en one/other, sl one/two/few/other) and no base key", (key) => {
    expect(formsIn(enKeys, key)).toEqual([...EN_FORMS].sort());
    expect(formsIn(slKeys, key)).toEqual([...SL_FORMS].sort());
    expect(enKeys[key]).toBeUndefined();
    expect(slKeys[key]).toBeUndefined();
    for (const form of EN_FORMS) expect(isFilled(enKeys[`${key}_${form}`])).toBe(true);
    for (const form of SL_FORMS) expect(isFilled(slKeys[`${key}_${form}`])).toBe(true);
  });

  it.each(PLURAL_KEYS)("%s carries {{count}} and the same placeholders in every form", (key) => {
    const expected = placeholders(enKeys[`${key}_other`]);
    expect(expected).toContain("count");
    for (const form of EN_FORMS) expect(placeholders(enKeys[`${key}_${form}`])).toEqual(expected);
    for (const form of SL_FORMS) expect(placeholders(slKeys[`${key}_${form}`])).toEqual(expected);
  });

  it("no single key carries {{count}} (every count string is a plural)", () => {
    const withCount = SINGLE_KEYS.filter(
      (key) => placeholders(enKeys[key]).includes("count") || placeholders(slKeys[key]).includes("count")
    );
    expect(withCount).toEqual([]);
  });

  it("the settings keys in the files are exactly this list (en and sl)", () => {
    expect(new Set(baseKeysInFile(enKeys))).toEqual(new Set(U29A_KEYS));
    expect(new Set(baseKeysInFile(slKeys))).toEqual(new Set(U29A_KEYS));
  });
});
