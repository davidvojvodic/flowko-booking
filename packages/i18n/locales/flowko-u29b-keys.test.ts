// Flowko U29b: every string key the roster editor „Urnik“ added (Tasks 6 to 9) exists in en and sl with the
// same {{placeholders}}, no value is empty, and every {{count}} string is an i18next plural with all its forms
// (sl _one, _two, _few, _other; en _one, _other). The test checks keys, forms and placeholders, not texts: the
// Slovene wording may change. U29b added no flowko_desk_* key (flowko-u28-keys.test.ts pins those); its two
// flowko_settings_* keys (D1 polish, Task 1a) are listed in flowko-u29a-keys.test.ts.
import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

// Base keys (plural suffix stripped), in file order; the list is exactly the U29b roster diff of the two locale files.
const U29B_KEYS = [
  // Task 6: the Urnik view, the leave guard and the mode toggle (S1, S11, S13).
  "flowko_roster_view",
  "flowko_roster_unsaved_title",
  "flowko_roster_unsaved_body",
  "flowko_roster_unsaved_stay",
  "flowko_roster_unsaved_discard",
  "flowko_roster_mode_week",
  "flowko_roster_mode_usual",
  // Task 7: grid, holiday menu, weekday arrows, differs-from-usual marker (S1, S8, S10, S11).
  "flowko_roster_off",
  "flowko_roster_open_day",
  "flowko_roster_close_day",
  "flowko_roster_holiday_off_hint",
  "flowko_roster_holiday_off_link",
  "flowko_roster_holiday_dirty_hint",
  "flowko_roster_differs_usual",
  "flowko_roster_holiday_error",
  "flowko_roster_prev_weekday",
  "flowko_roster_next_weekday",
  // Task 8: save bar, discard, copy previous week, stale, cell sheet, warnings dialog, save errors (S12 to S15).
  "flowko_roster_changes",
  "flowko_roster_discard",
  "flowko_roster_discard_title",
  "flowko_roster_usual_note",
  "flowko_roster_copy_previous",
  "flowko_roster_stale",
  "flowko_roster_cell_apply",
  "flowko_roster_cell_usual",
  "flowko_roster_cell_shifts",
  "flowko_roster_add_shift",
  "flowko_roster_opening_hint",
  "flowko_roster_warnings_title",
  "flowko_roster_warning_outside",
  "flowko_roster_warning_bookings",
  "flowko_roster_warnings_unchanged",
  "flowko_roster_warnings_save",
  "flowko_roster_error_forbidden",
  "flowko_roster_error_bad_roster",
  "flowko_roster_error_week_out_of_range",
  "flowko_roster_error_roster_conflict",
  "flowko_roster_error_bad_absence",
  "flowko_roster_error_not_a_holiday",
  // Task 9: absences from a cell (S7).
  "flowko_roster_absence_title",
  "flowko_roster_absence_end",
  "flowko_roster_absence_add",
  "flowko_roster_absence_range",
  "flowko_roster_absence_day",
  "flowko_roster_absence_remove",
  "flowko_roster_absence_dirty_hint",
  "flowko_roster_absence_confirm_title",
  "flowko_roster_absence_bookings",
  "flowko_roster_absence_confirm_add",
  "flowko_roster_cell_changed",
  // Slovene read (10 Nov): own body for the discard confirm.
  "flowko_roster_discard_body",
  // Flowko U29c Task 1c-ii (P1): the Urnik notice after a save whose refresh failed.
  "flowko_roster_refresh_failed",
];

// The {{count}} strings: stored only as plural forms, never under the base key.
const PLURAL_KEYS = [
  "flowko_roster_changes",
  "flowko_roster_warning_bookings",
  "flowko_roster_absence_bookings",
];

const EN_FORMS = ["one", "other"];
const SL_FORMS = ["one", "two", "few", "other"];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const SINGLE_KEYS = U29B_KEYS.filter((key) => !PLURAL_KEYS.includes(key));

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
        .filter((key) => key.startsWith("flowko_roster_"))
        .map((key) => key.replace(PLURAL_SUFFIX, ""))
    )
  );

describe("U29b roster keys", () => {
  it("lists each key once and every plural key is in the list", () => {
    expect(new Set(U29B_KEYS).size).toBe(U29B_KEYS.length);
    expect(PLURAL_KEYS.filter((key) => !U29B_KEYS.includes(key))).toEqual([]);
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

  it("the roster keys in the files are exactly this list (en and sl)", () => {
    expect(new Set(baseKeysInFile(enKeys))).toEqual(new Set(U29B_KEYS));
    expect(new Set(baseKeysInFile(slKeys))).toEqual(new Set(U29B_KEYS));
  });
});
