// Flowko U29e: the shared member-name rule (RIGHTS-1, plan R5). A name is checked on its trimmed value: 1..80
// UTF-16 units ("length"), no control, bidi, line-separator or invisible character and something visible left
// ("characters"); ZWJ / ZWNJ stay allowed (emoji, scripts). nameKey folds the default-ignorables before NFC, so a
// look-alike with a joiner or a soft hyphen collides with the plain name. Every code point in this file is written
// as an escape, never as a literal; the source pin at the end keeps it that way for every Flowko source and test.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBER_NAME_MAX, memberNameProblem, nameKey } from "./memberName";

/** A test title shows every non-ASCII character as U+XXXX, so no invisible character reaches the output. */
const shown = (name: string) =>
  name.replace(/[^\x20-\x7e]/g, (c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);

describe("memberNameProblem", () => {
  it("is length for an empty, a blank and an 81-unit name; 80 units (after trim) pass", () => {
    expect(MEMBER_NAME_MAX).toBe(80);
    expect(memberNameProblem("")).toBe("length");
    expect(memberNameProblem("   ")).toBe("length");
    expect(memberNameProblem("a".repeat(81))).toBe("length");
    expect(memberNameProblem("a".repeat(80))).toBeNull();
    expect(memberNameProblem(`  ${"a".repeat(80)}  `)).toBeNull();
  });

  it.each([
    ["NUL", "A\u0000"],
    ["BEL", "A\u0007"],
    ["DEL", "A\u007F"],
    ["C1 NEL", "A\u0085"],
    ["ZWSP at the end", "Ana\u200B"],
    ["word joiner inside", "An\u2060a"],
    ["BOM inside", "A\uFEFFna"],
    ["RLO", "Ana\u202E"],
    ["LRI", "Ana\u2066x"],
    ["LRM", "Ana\u200E"],
    ["Arabic letter mark", "Ana\u061C"],
    ["line separator inside", "An\u2028a"],
    ["paragraph separator inside", "An\u2029a"],
  ])("refuses %s as characters", (_label, name) => {
    expect(memberNameProblem(name)).toBe("characters");
  });

  it.each([
    ["ZWJ only", "\u200D"],
    ["ZWNJ + ZWJ only", "\u200C\u200D"],
    ["soft hyphen only", "\u00AD"],
    ["joiners around a space", "\u200D \u200D"],
  ])("refuses a name with nothing visible left (%s) as characters", (_label, name) => {
    expect(memberNameProblem(name)).toBe("characters");
  });

  it.each(
    [
      "Ana Novak",
      "\u0160\u00E1rka \u017D.",
      "Ana & Maja",
      "O'Brien",
      // Family emoji: woman, ZWJ, girl (surrogate pairs; no refused code unit).
      "Ana \uD83D\uDC69\u200D\uD83D\uDC67",
      "Ana\u200C",
      "  Ana  ",
    ].map((name) => [shown(name), name])
  )("allows %j", (_shown, name) => {
    expect(memberNameProblem(name)).toBeNull();
  });
});

describe("nameKey", () => {
  it("folds case and the surrounding blanks by Slovene rules", () => {
    expect(nameKey("  MOJCA ")).toBe("mojca");
    expect(nameKey("\u010Caja")).toBe(nameKey("\u010DAJA"));
  });

  it("strips ZWJ, ZWNJ and the soft hyphen, so look-alikes collide", () => {
    expect(nameKey("Ana\u200D")).toBe(nameKey("ana"));
    expect(nameKey("A\u200Cna")).toBe(nameKey("ana"));
    expect(nameKey("A\u00ADna")).toBe(nameKey("ana"));
    expect(nameKey("\u200D Ana")).toBe(nameKey("ana"));
  });

  it("composes (NFC) after the strip: a joiner between a letter and its accent still collides", () => {
    expect(nameKey("A\u0301")).toBe(nameKey("\u00C1"));
    expect(nameKey("A\u200D\u0301na")).toBe(nameKey("\u00C1na"));
  });

  it("is empty when nothing visible is left", () => {
    expect(nameKey("\u200D")).toBe("");
    expect(nameKey("\u00AD\u034F\u180E")).toBe("");
  });
});

// The source pin: no literal invisible or bidi character in Flowko source or tests (they would be invisible to
// every reader), and no regex `u` flag in this rule (the trpc build targets ES5).
const ROOT = resolve(__dirname, "../../..");
const DIRS = [
  "packages/lib/flowkoBusiness/",
  "packages/features/flowkoBusiness/",
  "apps/web/modules/",
  "apps/web/lib/flowko/",
  "packages/emails/",
  "packages/i18n/locales/",
  // Flowko U29e final review RIGHTS-2: the rest of the Flowko source (routers, API route, salon lib, pages).
  "packages/trpc/server/routers/viewer/flowko/",
  "apps/web/app/api/flowko/",
  "packages/lib/flowkoSalon/",
  "apps/web/app/(use-page-wrapper)/auth/pridruzi/",
  "apps/web/app/(use-page-wrapper)/settings/(settings-layout)/podjetje/",
];
/** Under apps/web/modules and packages/i18n/locales only the Flowko entries; every file of the other directories. */
const IN_SCOPE = (file: string) => {
  if (file.startsWith("apps/web/modules/")) return file.startsWith("apps/web/modules/flowko-");
  if (file.startsWith("packages/i18n/locales/")) return file.startsWith("packages/i18n/locales/flowko-");
  return true;
};
const TEXT_FILE = /\.(tsx?|jsx?|mjs|cjs|json|snap|html|md|ya?ml|css)$/;
const LITERAL_INVISIBLE = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/;

function scopedFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...DIRS],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
  ).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => IN_SCOPE(file) && TEXT_FILE.test(file))
    .filter((file) => existsSync(resolve(ROOT, file)));
}

describe("source pin", () => {
  it("no Flowko source or test file holds a literal invisible or bidi character", () => {
    const files = scopedFiles();
    expect(files).toContain("packages/lib/flowkoBusiness/memberName.ts");
    expect(files).toContain("packages/lib/flowkoBusiness/memberName.test.ts");
    expect(files.some((f) => f.startsWith("apps/web/modules/flowko-"))).toBe(true);
    expect(files.some((f) => f.startsWith("packages/i18n/locales/flowko-"))).toBe(true);
    // Flowko U29e final review RIGHTS-2: one file per added directory, so a wrong path cannot pass vacuously.
    expect(files).toContain("packages/trpc/server/routers/viewer/flowko/_router.tsx");
    expect(files).toContain("apps/web/app/api/flowko/pridruzi/route.ts");
    expect(files).toContain("packages/lib/flowkoSalon/index.ts");
    expect(files).toContain("apps/web/app/(use-page-wrapper)/auth/pridruzi/[token]/page.tsx");
    expect(files).toContain("apps/web/app/(use-page-wrapper)/settings/(settings-layout)/podjetje/page.tsx");
    const offenders = files.filter((file) =>
      LITERAL_INVISIBLE.test(readFileSync(resolve(ROOT, file), "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  // Flowko U29e final review RIGHTS-2: the flowko_* values of the shared locale files reach the UI and mail subjects.
  it("no flowko_* value in the sl or en common.json holds a literal invisible or bidi character", () => {
    for (const lang of ["sl", "en"]) {
      const strings = JSON.parse(
        readFileSync(resolve(ROOT, `packages/i18n/locales/${lang}/common.json`), "utf8")
      ) as Record<string, unknown>;
      const flowko = Object.entries(strings).filter(([key]) => key.startsWith("flowko_"));
      expect(flowko.length).toBeGreaterThan(0);
      const offenders = flowko
        .filter(([, value]) => typeof value === "string" && LITERAL_INVISIBLE.test(value))
        .map(([key]) => `${lang}:${key}`);
      expect(offenders).toEqual([]);
    }
  });

  it("the rule's regexes carry no u (or v) flag", () => {
    const source = readFileSync(resolve(ROOT, "packages/lib/flowkoBusiness/memberName.ts"), "utf8");
    expect(source).toMatch(/\]\//);
    expect(source).not.toMatch(/\]\/[a-z]*[uv][a-z]*/);
  });
});
