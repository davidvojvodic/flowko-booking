// Flowko U29c: every string key the owner's „Delavci“ page added (Task 6) exists in en and sl with the same
// {{placeholders}}, no value is empty, and every {{count}} string is an i18next plural with all its forms (sl _one,
// _two, _few, _other; en _one, _other). The test checks keys, forms and placeholders, not texts: the Slovene wording
// may change (Task 9 read). The U29c polish keys outside this prefix (flowko_settings_refresh_failed,
// flowko_settings_refresh, flowko_settings_service_broken, flowko_roster_refresh_failed) sit in the U29a and U29b lists.
import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

// Base keys (plural suffix stripped), in file order; the list is exactly the U29c workers diff of the two locale files.
const U29C_KEYS = [
  // The list: title, badges, order arrows, lock and unlock.
  "flowko_workers_title",
  "flowko_workers_title_description",
  "flowko_workers_role_staff",
  "flowko_workers_status_active",
  "flowko_workers_status_locked",
  "flowko_workers_status_no_login",
  "flowko_workers_you",
  "flowko_workers_move_up",
  "flowko_workers_move_down",
  "flowko_workers_lock",
  "flowko_workers_unlock",
  // The lock dialog, its toasts and the Google retry.
  "flowko_workers_lock_title",
  "flowko_workers_lock_bookings",
  "flowko_workers_lock_no_bookings",
  "flowko_workers_lock_login",
  "flowko_workers_locked",
  "flowko_workers_unlocked",
  "flowko_workers_google_failed",
  "flowko_workers_retry_google",
  // The locked worker's bookings.
  "flowko_workers_handover_hint",
  "flowko_workers_more_bookings",
  "flowko_workers_no_bookings",
  // „Dodaj brez prijave“.
  "flowko_workers_add_title",
  "flowko_workers_add_name",
  "flowko_workers_add_button",
  "flowko_workers_added",
  // Errors per procedure (W10).
  "flowko_workers_error_bad_name",
  "flowko_workers_error_member_name_taken",
  "flowko_workers_error_order_changed",
  "flowko_workers_error_forbidden",
  "flowko_workers_error_owner_cannot_be_locked",
  "flowko_workers_error_member_not_locked",
  "flowko_workers_error_member_conflict",
];

// The {{count}} strings: stored only as plural forms, never under the base key.
const PLURAL_KEYS = ["flowko_workers_lock_bookings", "flowko_workers_more_bookings"];

const EN_FORMS = ["one", "other"];
const SL_FORMS = ["one", "two", "few", "other"];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const SINGLE_KEYS = U29C_KEYS.filter((key) => !PLURAL_KEYS.includes(key));

const placeholders = (text: string): string[] =>
  Array.from(new Set(Array.from(text.matchAll(/{{\s*(\w+)\s*}}/g), (m) => m[1]))).sort();

const formsIn = (keys: Record<string, string>, base: string): string[] =>
  Object.keys(keys)
    .filter(
      (key) =>
        key.startsWith(`${base}_`) && PLURAL_SUFFIX.test(key) && key.replace(PLURAL_SUFFIX, "") === base
    )
    .map((key) => key.slice(base.length + 1))
    .sort();

const isFilled = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const baseKeysInFile = (keys: Record<string, string>): string[] =>
  Array.from(
    new Set(
      Object.keys(keys)
        .filter((key) => key.startsWith("flowko_workers_"))
        .map((key) => key.replace(PLURAL_SUFFIX, ""))
    )
  );

describe("U29c workers keys", () => {
  it("lists each key once and every plural key is in the list", () => {
    expect(new Set(U29C_KEYS).size).toBe(U29C_KEYS.length);
    expect(PLURAL_KEYS.filter((key) => !U29C_KEYS.includes(key))).toEqual([]);
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

  it.each(
    PLURAL_KEYS
  )("%s has every plural form (en one/other, sl one/two/few/other) and no base key", (key) => {
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

  it("the workers keys in the files are exactly this list (en and sl)", () => {
    expect(new Set(baseKeysInFile(enKeys))).toEqual(new Set(U29C_KEYS));
    expect(new Set(baseKeysInFile(slKeys))).toEqual(new Set(U29C_KEYS));
  });
});
