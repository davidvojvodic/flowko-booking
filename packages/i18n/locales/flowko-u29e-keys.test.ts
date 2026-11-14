// Flowko U29e: the exact list of every string key U29e adds, across all prefixes (workers, invite, settings, desk and
// the new cancel-notice mail), each present in en and sl with the same {{placeholders}}, no empty value, no plural
// forms, no {{count}} and no `<n>` tag (no name ever goes through ServerTrans). The test checks keys, forms and
// placeholders, not texts: the Slovene wording may change (the Task 13 read). The four keys whose text changed keep
// their key and are only checked to exist. The area lists (flowko-u28/u29a/u29c/u29d-keys.test.ts) each hold their
// own U29e keys too; this file is the cross-prefix pin, and the mail prefix `flowko_cancel_notice_` is pinned here
// only (no existing exact list has it).
import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

// In the plan's Keys-section order: workers, invite, settings, desk, mail.
const U29E_WORKERS_KEYS = [
  "flowko_workers_added_no_week",
  "flowko_workers_add_hint",
  "flowko_workers_add_hint_week",
  "flowko_workers_error_name_characters",
  "flowko_workers_rename_title",
  "flowko_workers_rename_hint",
  "flowko_workers_rename_hint_desk",
  "flowko_workers_rename_hint_login",
  "flowko_workers_renamed",
];

const U29E_INVITE_KEYS = ["flowko_invite_hint_new_worker_no_week"];

const U29E_SETTINGS_KEYS = [
  "flowko_settings_service_price",
  "flowko_settings_service_price_hint",
  "flowko_settings_service_field_price_format",
  "flowko_settings_service_field_price_range",
];

const U29E_DESK_KEYS = [
  "flowko_desk_cancelled_by_customer",
  "flowko_desk_cancelled_by_desk",
  "flowko_desk_history_cancelled_customer",
  "flowko_desk_cancel_reason_line",
  "flowko_desk_price_total",
  "flowko_desk_price_partial",
];

// The business notice mail (E7): its own prefix, an exact list in the files.
const NOTICE_PREFIX = "flowko_cancel_notice_";
const U29E_NOTICE_KEYS = [
  "flowko_cancel_notice_subject",
  "flowko_cancel_notice_heading",
  "flowko_cancel_notice_customer",
  "flowko_cancel_notice_phone",
  "flowko_cancel_notice_services",
  "flowko_cancel_notice_worker",
  "flowko_cancel_notice_when",
  "flowko_cancel_notice_when_value",
  "flowko_cancel_notice_reason",
  "flowko_cancel_notice_no_reason",
  "flowko_cancel_notice_open_day",
  "flowko_cancel_notice_reply_hint",
  "flowko_cancel_notice_footer",
  "flowko_cancel_notice_footer_fallback",
];

const U29E_KEYS = [
  ...U29E_WORKERS_KEYS,
  ...U29E_INVITE_KEYS,
  ...U29E_SETTINGS_KEYS,
  ...U29E_DESK_KEYS,
  ...U29E_NOTICE_KEYS,
];

// Existing keys whose text U29e changed (R4, R14, R18, R23); the key stays, so no list edit anywhere.
const TEXT_CHANGED_KEYS = [
  "flowko_workers_added",
  "flowko_workers_handover_hint",
  "flowko_settings_refresh_failed",
  "flowko_settings_email_hint",
];

// The prefixes of the exact area lists (U28, U29a, U29b, U29c, U29d) that already existed before U29e.
const PINNED_PREFIXES = [
  "flowko_desk_",
  "flowko_settings_",
  "flowko_roster_",
  "flowko_workers_",
  "flowko_invite_",
];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const placeholders = (text: string): string[] =>
  Array.from(
    new Set(Array.from(text.matchAll(/{{\s*(\w+)\s*}}/g), (m) => m[1]))
  ).sort();

const formsIn = (keys: Record<string, string>, base: string): string[] =>
  Object.keys(keys)
    .filter(
      (key) =>
        key.startsWith(`${base}_`) &&
        PLURAL_SUFFIX.test(key) &&
        key.replace(PLURAL_SUFFIX, "") === base
    )
    .map((key) => key.slice(base.length + 1))
    .sort();

const isFilled = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

const noticeKeysIn = (keys: Record<string, string>): string[] =>
  Object.keys(keys).filter((key) => key.startsWith(NOTICE_PREFIX));

describe("U29e keys", () => {
  it("lists 34 keys (9 workers, 1 invite, 4 settings, 6 desk, 14 mail), each once", () => {
    expect(U29E_WORKERS_KEYS).toHaveLength(9);
    expect(U29E_INVITE_KEYS).toHaveLength(1);
    expect(U29E_SETTINGS_KEYS).toHaveLength(4);
    expect(U29E_DESK_KEYS).toHaveLength(6);
    expect(U29E_NOTICE_KEYS).toHaveLength(14);
    expect(U29E_KEYS).toHaveLength(34);
    expect(new Set(U29E_KEYS).size).toBe(U29E_KEYS.length);
  });

  it("each group sits under its own prefix", () => {
    expect(
      U29E_WORKERS_KEYS.every((key) => key.startsWith("flowko_workers_"))
    ).toBe(true);
    expect(
      U29E_INVITE_KEYS.every((key) => key.startsWith("flowko_invite_"))
    ).toBe(true);
    expect(
      U29E_SETTINGS_KEYS.every((key) => key.startsWith("flowko_settings_"))
    ).toBe(true);
    expect(U29E_DESK_KEYS.every((key) => key.startsWith("flowko_desk_"))).toBe(
      true
    );
    expect(U29E_NOTICE_KEYS.every((key) => key.startsWith(NOTICE_PREFIX))).toBe(
      true
    );
  });

  it.each(U29E_KEYS)(
    "%s exists in en and sl, not empty, with no plural forms",
    (key) => {
      expect(isFilled(enKeys[key])).toBe(true);
      expect(isFilled(slKeys[key])).toBe(true);
      expect(formsIn(enKeys, key)).toEqual([]);
      expect(formsIn(slKeys, key)).toEqual([]);
    }
  );

  it.each(U29E_KEYS)("%s has the same placeholders in en and sl", (key) => {
    expect(placeholders(slKeys[key])).toEqual(placeholders(enKeys[key]));
  });

  it("no key carries {{count}}", () => {
    const withCount = U29E_KEYS.filter(
      (key) =>
        placeholders(enKeys[key]).includes("count") ||
        placeholders(slKeys[key]).includes("count")
    );
    expect(withCount).toEqual([]);
  });

  it("no string carries a <n> tag (no name goes through ServerTrans)", () => {
    const tagged = U29E_KEYS.filter(
      (key) =>
        /<\/?\d+\s*\/?>/.test(enKeys[key]) || /<\/?\d+\s*\/?>/.test(slKeys[key])
    );
    expect(tagged).toEqual([]);
  });

  it("the flowko_cancel_notice_ keys in the files are exactly the mail list, none with a plural suffix (en and sl)", () => {
    expect(new Set(noticeKeysIn(enKeys))).toEqual(new Set(U29E_NOTICE_KEYS));
    expect(new Set(noticeKeysIn(slKeys))).toEqual(new Set(U29E_NOTICE_KEYS));
    expect(noticeKeysIn(enKeys)).toHaveLength(U29E_NOTICE_KEYS.length);
    expect(noticeKeysIn(slKeys)).toHaveLength(U29E_NOTICE_KEYS.length);
    expect(
      noticeKeysIn(enKeys).filter((key) => PLURAL_SUFFIX.test(key))
    ).toEqual([]);
    expect(
      noticeKeysIn(slKeys).filter((key) => PLURAL_SUFFIX.test(key))
    ).toEqual([]);
  });

  it("the mail prefix collides with no pinned exact-list prefix, in either direction", () => {
    for (const prefix of PINNED_PREFIXES) {
      expect(NOTICE_PREFIX.startsWith(prefix)).toBe(false);
      expect(prefix.startsWith(NOTICE_PREFIX)).toBe(false);
      expect(U29E_NOTICE_KEYS.some((key) => key.startsWith(prefix))).toBe(
        false
      );
    }
    // And no key of the other U29e groups starts with the mail prefix.
    expect(
      U29E_KEYS.filter(
        (key) =>
          !U29E_NOTICE_KEYS.includes(key) && key.startsWith(NOTICE_PREFIX)
      )
    ).toEqual([]);
  });

  it("the unpinned flowko_cancel_here key (not a mail key) stays outside the notice prefix", () => {
    expect(NOTICE_PREFIX.startsWith("flowko_cancel_here")).toBe(false);
    expect("flowko_cancel_here".startsWith(NOTICE_PREFIX)).toBe(false);
    expect(noticeKeysIn(enKeys)).not.toContain("flowko_cancel_here");
  });

  it.each(TEXT_CHANGED_KEYS)(
    "%s (text changed in U29e, key kept) still exists in en and sl",
    (key) => {
      expect(isFilled(enKeys[key])).toBe(true);
      expect(isFilled(slKeys[key])).toBe(true);
      expect(U29E_KEYS).not.toContain(key);
      expect(placeholders(slKeys[key])).toEqual(placeholders(enKeys[key]));
    }
  );
});
