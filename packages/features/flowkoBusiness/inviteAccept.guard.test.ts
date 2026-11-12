// Flowko U29d (D3): the deskEmailGuard exception is "exactly this write, by construction". deskEmailGuard.ts and its
// callers (profile, secondary e-mail, admin user edit) stay unchanged and keep refusing a desk placeholder address;
// the only Flowko code that writes a user's e-mail is the desk-only worker's creation (business.ts, the placeholder)
// and the invite accept (inviteAccept.ts: a brand-new login, and the C9 conversion that replaces the placeholder).
// This source pin fails when any other non-test file in the Flowko server, API, lib or invite-page directories
// writes an e-mail through a Prisma user create/update/upsert call or raw SQL, and when any of them reaches Cal's
// signup token path (selfHostedHandler, VerificationToken writes). A new writer must update this pin on purpose.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");

/** The five directories of D3 (the last two arrive with U29d Task 8; an absent directory has no files). */
const DIRS = [
  "packages/features/flowkoBusiness/",
  "apps/web/app/api/flowko/",
  "packages/trpc/server/routers/viewer/flowko/",
  "packages/lib/flowkoBusiness/",
  "apps/web/modules/flowko-invite/",
];

/** The only files allowed to write a user's e-mail (D3). */
const EMAIL_WRITERS = [
  "packages/features/flowkoBusiness/business.ts",
  "packages/features/flowkoBusiness/inviteAccept.ts",
];

const TEST_FILE = /\.(test|integration-test|spec)\.tsx?$|\.fixture\.tsx?$|\/__tests__\//;

// A Prisma write call on the user model (any client name: prisma, tx, db, ...).
const USER_WRITE_CALL =
  /\buser\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/g;
// An e-mail key in the call's argument: `email:`, or the shorthand `{ email }` / `{ email, ... }`.
const EMAIL_KEY = /\bemail\s*[:,}]/;
// Raw SQL writing the users table's e-mail, and any Kysely write of the users table.
const RAW_EMAIL_WRITE =
  /UPDATE\s+"?users"?\s+SET\b[^;`]*\bemail\b|INSERT\s+INTO\s+"?users"?\s*\([^)]*\bemail\b/i;
const KYSELY_USERS_WRITE = /\b(updateTable|insertInto)\s*\(\s*["']users["']\s*\)/;
// Cal's signup token path.
const VERIFICATION_TOKEN_WRITE =
  /\bverificationToken\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(|\bverificationTokens?\s*:\s*\{\s*(create|createMany|connectOrCreate|upsert)\b/;

// Tracked and untracked (not ignored) TypeScript files under the five directories.
function sourceFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...DIRS],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
  ).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file) && !TEST_FILE.test(file))
    .filter((file) => existsSync(resolve(ROOT, file)));
}

const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

/** The argument text of the call whose "(" is at `open` (balanced parentheses; the rest of the file if unbalanced). */
function callArgument(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** True when a user create/update/upsert call in `text` carries an e-mail key, or raw SQL / Kysely writes users. */
function writesUserEmail(text: string): boolean {
  for (const match of Array.from(text.matchAll(USER_WRITE_CALL))) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (EMAIL_KEY.test(callArgument(text, open))) return true;
  }
  return RAW_EMAIL_WRITE.test(text) || KYSELY_USERS_WRITE.test(text);
}

describe("U29d D3: the only Flowko writers of a user's e-mail", () => {
  it("the matcher sees every write form and ignores other user writes (positive and negative controls)", () => {
    expect(writesUserEmail(`await tx.user.update({ where: { id }, data: { email: next, name } });`)).toBe(
      true
    );
    expect(writesUserEmail(`await prisma.user.create({\n  data: {\n    email,\n    name,\n  },\n});`)).toBe(
      true
    );
    expect(writesUserEmail(`db.user.upsert({ where: { id }, create: { email: a }, update: {} })`)).toBe(true);
    expect(writesUserEmail(`tx.user.updateMany({ where: { id: { in: ids } }, data: { email: x } })`)).toBe(
      true
    );
    expect(writesUserEmail("await tx.$executeRaw`UPDATE users SET email = ${x} WHERE id = ${id}`;")).toBe(
      true
    );
    expect(writesUserEmail(`await kysely.updateTable("users").set({ name }).execute();`)).toBe(true);
    expect(writesUserEmail(`await tx.user.update({ where: { id }, data: { locked } });`)).toBe(false);
    expect(writesUserEmail(`await tx.user.findFirst({ where: { email: x } });`)).toBe(false);
    expect(writesUserEmail(`await tx.secondaryEmail.create({ data: { email: x, userId } });`)).toBe(false);
  });

  it("in the five directories the non-test code writing a user's e-mail is exactly business.ts and inviteAccept.ts", () => {
    const files = sourceFiles();
    // Plausible file list: the server modules, the tRPC routers and the lib helpers are all scanned.
    expect(files).toEqual(
      expect.arrayContaining([...EMAIL_WRITERS, "packages/features/flowkoBusiness/lock.ts"])
    );
    expect(files.some((file) => file.startsWith("packages/trpc/server/routers/viewer/flowko/"))).toBe(true);
    expect(files.some((file) => file.startsWith("packages/lib/flowkoBusiness/"))).toBe(true);

    const writers = files.filter((file) => writesUserEmail(read(file))).sort();
    expect(writers).toEqual(EMAIL_WRITERS);
  });

  it("no file there reaches Cal's signup token path (selfHostedHandler, VerificationToken writes)", () => {
    const hits = sourceFiles().filter((file) => {
      const text = read(file);
      return /\bselfHostedHandler\b/.test(text) || VERIFICATION_TOKEN_WRITE.test(text);
    });
    expect(hits).toEqual([]);
  });
});
