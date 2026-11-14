// Flowko U29d: every `flowko_invite_*` string key (the Delavci invite UI, the accept page and the invite mail) exists
// in en and sl with the same {{placeholders}}, no value is empty, no key has plural forms or a {{count}}, and no
// string carries a `<n>` tag (no name ever passes through ServerTrans, A7). The test checks keys, forms and
// placeholders, not texts: the Slovene wording may change (Task 10 read). The mail texts are pinned verbatim by
// packages/emails/flowko-u29d-invite.test.ts. Reused existing keys (invite, resend, email, close, …) are not listed.
// Flowko U29e: one key appended (flowko_invite_hint_new_worker_no_week, E5 R4: the brand-new WORKER hint when the
// owner has no usual week), so the list holds 56 keys.
import { describe, expect, it } from "vitest";

import en from "./en/common.json";
import sl from "./sl/common.json";

const enKeys = en as Record<string, string>;
const slKeys = sl as Record<string, string>;

// In the plan's Keys-table order; the list is exactly the U29d diff of the two locale files + one U29e key.
const U29D_KEYS = [
  // Delavci: the invite form („Povabi s prijavo“).
  "flowko_invite_form_title",
  "flowko_invite_form_hint",
  "flowko_invite_form_role",
  "flowko_invite_role_worker_hint",
  "flowko_invite_role_staff_hint",
  "flowko_invite_send",
  // The link panel.
  "flowko_invite_panel_title",
  "flowko_invite_sent",
  "flowko_invite_not_sent",
  "flowko_invite_link_label",
  "flowko_invite_copy",
  "flowko_invite_copied",
  "flowko_invite_copy_failed",
  "flowko_invite_link_once",
  "flowko_invite_hint_new_worker",
  "flowko_invite_hint_desk_worker",
  // The list: statuses, validity, „Povabljeni“, the desk-only dialog and the row actions.
  "flowko_invite_status_pending",
  "flowko_invite_status_expired",
  "flowko_invite_valid_until",
  "flowko_invite_expired_on",
  "flowko_invite_pending_title",
  "flowko_invite_dialog_title",
  "flowko_invite_dialog_body",
  "flowko_invite_new_link",
  "flowko_invite_new_link_ready",
  "flowko_invite_resent",
  "flowko_invite_resent_no_address",
  "flowko_invite_revoke",
  "flowko_invite_revoked",
  // Errors (U4).
  "flowko_invite_error_email_has_login",
  "flowko_invite_error_invite_bad_email",
  "flowko_invite_error_invite_pending",
  "flowko_invite_error_invite_gone",
  "flowko_invite_error_member_not_desk_only",
  // The accept page (Task 8).
  "flowko_invite_accept_meta_title",
  "flowko_invite_accept_title",
  "flowko_invite_accept_privacy",
  "flowko_invite_accept_privacy_link",
  "flowko_invite_accept_submit",
  "flowko_invite_accept_invalid_title",
  "flowko_invite_accept_invalid_body",
  "flowko_invite_accept_signed_in_title",
  "flowko_invite_accept_signed_in_body",
  "flowko_invite_accept_created",
  "flowko_invite_accept_contact_salon",
  "flowko_invite_accept_email_hint",
  "flowko_invite_accept_name_taken",
  "flowko_invite_accept_password_too_long",
  // The invite mail (Task 6).
  "flowko_invite_mail_subject",
  "flowko_invite_mail_intro",
  "flowko_invite_mail_cta",
  "flowko_invite_mail_expiry",
  "flowko_invite_mail_link_text",
  "flowko_invite_mail_ignore",
  "flowko_invite_mail_reply",
  // Flowko U29e (E5, R4): the brand-new WORKER hint when the owner has no usual week.
  "flowko_invite_hint_new_worker_no_week",
];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

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

const keysInFile = (keys: Record<string, string>): string[] =>
  Object.keys(keys).filter((key) => key.startsWith("flowko_invite_"));

describe("U29d invite keys", () => {
  it("lists 56 keys, each once", () => {
    expect(U29D_KEYS).toHaveLength(56);
    expect(new Set(U29D_KEYS).size).toBe(U29D_KEYS.length);
  });

  it.each(U29D_KEYS)("%s exists in en and sl, not empty, with no plural forms", (key) => {
    expect(isFilled(enKeys[key])).toBe(true);
    expect(isFilled(slKeys[key])).toBe(true);
    expect(formsIn(enKeys, key)).toEqual([]);
    expect(formsIn(slKeys, key)).toEqual([]);
  });

  it.each(U29D_KEYS)("%s has the same placeholders in en and sl", (key) => {
    expect(placeholders(slKeys[key])).toEqual(placeholders(enKeys[key]));
  });

  it("no key carries {{count}}", () => {
    const withCount = U29D_KEYS.filter(
      (key) => placeholders(enKeys[key]).includes("count") || placeholders(slKeys[key]).includes("count")
    );
    expect(withCount).toEqual([]);
  });

  it("no string carries a <n> tag (no name goes through ServerTrans)", () => {
    const tagged = U29D_KEYS.filter(
      (key) => /<\/?\d+\s*\/?>/.test(enKeys[key]) || /<\/?\d+\s*\/?>/.test(slKeys[key])
    );
    expect(tagged).toEqual([]);
  });

  it("the flowko_invite_ keys in the files are exactly this list, none with a plural suffix (en and sl)", () => {
    expect(new Set(keysInFile(enKeys))).toEqual(new Set(U29D_KEYS));
    expect(new Set(keysInFile(slKeys))).toEqual(new Set(U29D_KEYS));
    expect(keysInFile(enKeys).filter((key) => PLURAL_SUFFIX.test(key))).toEqual([]);
    expect(keysInFile(slKeys).filter((key) => PLURAL_SUFFIX.test(key))).toEqual([]);
  });

  it("no existing exact-list prefix collides with flowko_invite_ (the u28, u29a, u29b, u29c lists stay untouched)", () => {
    for (const prefix of ["flowko_desk_", "flowko_settings_", "flowko_roster_", "flowko_workers_"]) {
      expect(U29D_KEYS.some((key) => key.startsWith(prefix))).toBe(false);
    }
  });
});
