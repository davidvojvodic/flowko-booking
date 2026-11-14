// Flowko U29e: the one member-name rule (RIGHTS-1, plan R5), shared by the server (displayNameOrThrow, every name
// entry point) and the name forms (add, invite, rename, accept), so a form shows the same refusal before it calls.
// Pure and client-safe: no server import. The regexes are explicit escaped ranges without the `u` flag (the trpc
// build targets ES5) and without the `g` flag (no lastIndex state); the source pin in memberName.test.ts keeps
// every invisible character an escape, never a literal.

/** At most 80 UTF-16 units after trim; never more code points, so the database's 1..80 CHECKs always hold. */
export const MEMBER_NAME_MAX = 80;

export type MemberNameProblem = "length" | "characters";

/**
 * Refused anywhere in the trimmed name: C0 controls, DEL and C1 controls (NUL used to reach Postgres as a 500);
 * the bidi controls ALM, LRM, RLM, LRE..RLO and LRI..PDI; the line and paragraph separators (they would reach
 * booking titles and mail subjects); and the invisible ZWSP, WJ and BOM. ZWNJ and ZWJ stay allowed (emoji
 * sequences, scripts); nameKey folds them instead.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
const REFUSED_CHARACTER_RE =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u2028-\u202E\u2060\u2066-\u2069\uFEFF]/;

/** Default-ignorables a reader cannot see: soft hyphen, CGJ, ALM, MVS, ZWSP..RLM, LRE..RLO, WJ..U+206F, BOM. */
const DEFAULT_IGNORABLE_RE = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;

/**
 * One comparison key per name: trimmed, the default-ignorables stripped (before NFC, so a joiner between a letter
 * and its combining accent still collides), trimmed again, Unicode-composed (NFC), lower-cased by Slovene rules.
 * „Ana“ with a ZWJ, a ZWNJ or a soft hyphen therefore collides with „Ana“ (member_name_taken). "" when nothing
 * visible is left.
 */
export function nameKey(name: string): string {
  return name.trim().split(DEFAULT_IGNORABLE_RE).join("").trim().normalize("NFC").toLocaleLowerCase("sl");
}

/**
 * The problem of a name, judged on its trimmed value, or null when it may be stored: "length" when it is empty or
 * longer than MEMBER_NAME_MAX, "characters" when it holds a refused character or nothing visible is left (only
 * joiners, soft hyphens and the like).
 */
export function memberNameProblem(raw: string): MemberNameProblem | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MEMBER_NAME_MAX) return "length";
  if (REFUSED_CHARACTER_RE.test(trimmed) || nameKey(trimmed) === "") return "characters";
  return null;
}
