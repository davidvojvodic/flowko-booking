// Flowko U25: Teams guard. Upstream ships 18 PermissionCheckService stubs that answer true / [] for everyone. They stay
// harmless only while the database holds no Team, Membership or Host row: one Team row with EventType.teamId, or a
// Membership on a booking owner, would open cross-tenant access (BookingAccessService). Flowko businesses use their own
// prefixed tables (FlowkoBusiness*), so no Flowko code path may ever write the upstream Team / Membership / Host /
// HostGroup / Profile tables. This test fails when one does. Post-deploy SQL counts are at the bottom of this file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const SELF = relative(ROOT, __filename);

// P1-P4: writers of the upstream tables (Prisma client, nested writes, Kysely, raw SQL).
const WRITERS: Record<string, RegExp> = {
  P1: /\.(team|membership|host|hostGroup|profile)\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/,
  P2: /\b(members|memberships|hosts|teams|team|organization|profiles|orgProfiles|hostGroups|hostGroup|profile|children|parent)\s*:\s*\{\s*(create|createMany|connectOrCreate|upsert|connect)\b/,
  P3: /insertInto\(\s*["'](Team|Membership|Host|HostGroup|Profile)["']/,
  P4: /INSERT\s+INTO\s+"?(public"?\."?)?(Team|Membership|Host|HostGroup|Profile)"?/i,
};
// P5: a Flowko row pointing at a Team (teamId / parentId set to anything but null / undefined).
// The `\s` inside the lookahead stops `\s*` from backtracking over the space ("teamId: null" would match otherwise).
const P5 = /\b(teamId|parentId)\s*:\s*(?!\s|null\b|undefined\b)/;
// P6: the upstream repositories that write Team / Membership / Profile rows.
const P6 = /\b(MembershipRepository|TeamRepository|ProfileRepository)\b/;
// Import statements (static, multi-line, dynamic) and whole require lines: the text P6 is tested against.
const IMPORT_STATEMENT =
  /\bimport\b[^;"'`]*?\bfrom\s*["'][^"']+["']|\bimport\s*\(\s*["'][^"']+["']\s*\)|\bimport\s+["'][^"']+["']|^.*\brequire\s*\(.*$/gm;

function countMatches(pattern: RegExp, text: string): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return (text.match(new RegExp(pattern.source, flags)) ?? []).length;
}

function writerHits(text: string): number {
  return Object.values(WRITERS).reduce((sum, p) => sum + countMatches(p, text), 0);
}

function bannedImportHits(text: string): number {
  return (text.match(IMPORT_STATEMENT) ?? []).reduce(
    (sum, statement) => sum + countMatches(P6, statement),
    0
  );
}

// Tracked AND untracked (not ignored) files, so a new uncommitted writer is caught as well.
function listFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx", "*.sql"],
    { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }
  ).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(resolve(ROOT, file)));
}

const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

const FLOWKO_PATHS = [
  /^packages\/lib\/flowkoSalon\//,
  /^packages\/lib\/flowkoBusiness\//,
  /^packages\/features\/flowkoBusiness\//,
  /^apps\/web\/lib\/flowko\//,
  // Flowko U27: the call-the-business page.
  /^apps\/web\/app\/\(booking-page-wrapper\)\/poklicite\//,
  // Flowko U28: the desk page (/koledar) and its client modules.
  /^apps\/web\/app\/\(use-page-wrapper\)\/\(main-nav\)\/koledar\//,
  /^apps\/web\/modules\/flowko-desk\//,
  // Flowko U29a: the business settings pages (/settings/podjetje/*) and their client modules.
  /^apps\/web\/app\/\(use-page-wrapper\)\/settings\/\(settings-layout\)\/podjetje\//,
  /^apps\/web\/modules\/flowko-settings\//,
  // Flowko U26: the tRPC routers of viewer.flowko.* (roster API).
  /^packages\/trpc\/server\/routers\/viewer\/flowko\//,
  // Flowko U26: the page that serves viewer.flowko.* (/api/trpc/flowko/[trpc]).
  /^apps\/web\/pages\/api\/trpc\/flowko\//,
  // Flowko U29d: the invite accept page (/auth/pridruzi/<token>), its POST route (/api/flowko/pridruzi) and the
  // accept page's client modules.
  /^apps\/web\/app\/\(use-page-wrapper\)\/auth\/pridruzi\//,
  /^apps\/web\/app\/api\/flowko\//,
  /^apps\/web\/modules\/flowko-invite\//,
  /^packages\/prisma\/migrations\/[^/]*flowko[^/]*\/migration\.sql$/,
];

const NOT_SCANNED_FOR_UPSTREAM_WRITERS = [
  /\.test\./,
  /\.integration-test\./,
  /(^|\/)__tests__\//,
  /(^|\/)test\//,
  /(^|\/)tests\//,
  /^apps\/web\/playwright\//,
  /^apps\/api\/v2\//,
  /(^|\/)scripts\/seed[^/]*\.ts$/,
  /^packages\/testing\//,
];

// Measured on the base tree 60d0cad91a (U25 start): the 9 upstream files that can write Team / Membership / Host /
// HostGroup / Profile rows, with their P1-P4 match counts. A plain file allowlist would miss a new writer line in one of
// them (U25 itself edits next-auth-options.ts), so a count change fails here. Lowering a count after an upstream sync is
// fine: update it in the same commit. Raising it, or adding a file, needs a reason.
const UPSTREAM_WRITER_SNAPSHOT: Record<string, number> = {
  "packages/features/auth/lib/next-auth-options.ts": 3,
  "packages/features/auth/signup/utils/createOrUpdateMemberships.ts": 3,
  "packages/features/auth/signup/utils/organization.ts": 1,
  "packages/features/eventtypes/repositories/eventTypeRepository.ts": 3,
  "packages/features/membership/repositories/MembershipRepository.ts": 2,
  "packages/features/profile/repositories/ProfileRepository.ts": 7,
  "packages/features/users/repositories/UserRepository.ts": 1,
  "packages/prisma/migrations/20240130134919_add_profile_table_and_add_event_type_relation/migration.sql": 1,
  "packages/trpc/server/routers/viewer/eventTypes/heavy/update.handler.ts": 1,
};

describe("Teams guard", () => {
  const files = listFiles();

  it("scans a plausible file list", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("packages/features/auth/lib/next-auth-options.ts");
    expect(files.some((f) => /^packages\/lib\/flowkoSalon\//.test(f))).toBe(true);
    expect(files.some((f) => /^apps\/web\/lib\/flowko\//.test(f))).toBe(true);
    // Flowko U26: the viewer.flowko router files are scanned (and covered by FLOWKO_PATHS).
    const trpcFlowko = files.filter((f) => f.startsWith("packages/trpc/server/routers/viewer/flowko/"));
    expect(trpcFlowko).toContain("packages/trpc/server/routers/viewer/flowko/roster/roster.handler.ts");
    expect(trpcFlowko.every((f) => FLOWKO_PATHS.some((p) => p.test(f)))).toBe(true);
    const flowkoPage = "apps/web/pages/api/trpc/flowko/[trpc].ts";
    expect(files).toContain(flowkoPage);
    expect(FLOWKO_PATHS.some((p) => p.test(flowkoPage))).toBe(true);
    // Flowko U29d: the invite accept page, its POST route and its client modules are scanned and covered.
    for (const file of [
      "apps/web/app/(use-page-wrapper)/auth/pridruzi/[token]/page.tsx",
      "apps/web/app/api/flowko/pridruzi/route.ts",
      "apps/web/modules/flowko-invite/accept-view.tsx",
      "apps/web/modules/flowko-invite/InviteInvalid.tsx",
      "apps/web/modules/flowko-invite/InviteSignedIn.tsx",
    ]) {
      expect(files).toContain(file);
      expect(FLOWKO_PATHS.some((p) => p.test(file))).toBe(true);
    }
    // ...and nothing else under auth/ or api/ is taken for Flowko code by them
    for (const file of [
      "apps/web/app/(use-page-wrapper)/auth/login/page.tsx",
      "apps/web/app/api/auth/reset-password/route.ts",
      "apps/web/app/api/cancel/route.ts",
    ]) {
      expect(FLOWKO_PATHS.some((p) => p.test(file))).toBe(false);
    }
  });

  it("Flowko code never writes Team, Membership, Host, HostGroup or Profile, sets teamId / parentId or imports their repositories", () => {
    const hits: string[] = [];
    for (const file of files) {
      if (file === SELF || !FLOWKO_PATHS.some((p) => p.test(file))) continue;
      const text = read(file);
      for (const [name, pattern] of Object.entries(WRITERS)) {
        if (pattern.test(text)) hits.push(`${file}: ${name}`);
      }
      if (P5.test(text)) hits.push(`${file}: P5 teamId/parentId`);
      if (bannedImportHits(text) > 0) hits.push(`${file}: P6 banned import`);
    }
    expect(hits).toEqual([]);
  });

  it("the upstream writers stay exactly the 9 known files with their known counts", () => {
    const snapshot: Record<string, number> = {};
    for (const file of files) {
      if (NOT_SCANNED_FOR_UPSTREAM_WRITERS.some((p) => p.test(file))) continue;
      const count = writerHits(read(file));
      if (count > 0) snapshot[file] = count;
    }
    expect(snapshot).toEqual(UPSTREAM_WRITER_SNAPSHOT);
  });

  it("every pattern matches its fixture, and P5 ignores null / undefined", () => {
    expect(WRITERS.P1.test("await prisma.team.create({ data })")).toBe(true);
    expect(WRITERS.P1.test("await tx.membership.upsert({ where })")).toBe(true);
    expect(WRITERS.P1.test("await tx.host.createMany({ data })")).toBe(true);
    expect(WRITERS.P1.test("await tx.flowkoBusinessMember.create({ data })")).toBe(false);
    expect(WRITERS.P2.test("data: { hosts: { create: [] } }")).toBe(true);
    expect(WRITERS.P2.test("data: { members: { create: { userId } } }")).toBe(true);
    expect(WRITERS.P2.test("data: { profiles: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { orgProfiles: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { hostGroups: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { hostGroup: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { profile: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { children: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { parent: { create: {} } }")).toBe(true);
    expect(WRITERS.P2.test("data: { flowkoBusinessMembers: { create: {} } }")).toBe(false);
    expect(WRITERS.P3.test('db.insertInto("Host").values(rows)')).toBe(true);
    expect(WRITERS.P4.test('INSERT INTO "public"."Team" (name) VALUES (1)')).toBe(true);
    expect(WRITERS.P4.test('INSERT INTO "FlowkoBusiness" (name) VALUES (1)')).toBe(false);
    expect(P5.test("teamId: 5")).toBe(true);
    expect(P5.test("parentId: teamId")).toBe(true);
    expect(P5.test("teamId: null")).toBe(false);
    expect(P5.test("parentId: undefined")).toBe(false);
    expect(P5.test("teamId:null")).toBe(false);
    expect(P5.test("teamId:   undefined,")).toBe(false);
    expect(P5.test("teamId:\n    5")).toBe(true);
    expect(bannedImportHits('import { MembershipRepository } from "@calcom/features/membership/x"')).toBe(1);
    expect(bannedImportHits('import {\n  a,\n  TeamRepository,\n} from "@calcom/features/ee/teams/x";')).toBe(
      1
    );
    expect(bannedImportHits('const { ProfileRepository } = require("@calcom/features/profile/x");')).toBe(1);
    expect(
      bannedImportHits('const m = await import("@calcom/features/membership/MembershipRepository");')
    ).toBe(1);
    expect(
      bannedImportHits('import { FlowkoBusinessRepository } from "./x";\nconst TeamRepositoryNote = 1;')
    ).toBe(0);
  });
});

// Post-deploy SQL (production, read-only, after each release that touches Flowko business code; every count is 0 except
// HostGroup, which is reported, not gated: a HostGroup row can exist on a personal event type
// (eventTypes/heavy/update.handler.ts:441-468) and grants nothing on its own).
//
//   SELECT 'Team', count(*) FROM "Team" UNION ALL SELECT 'Membership', count(*) FROM "Membership"
//   UNION ALL SELECT 'Host', count(*) FROM "Host" UNION ALL SELECT 'Profile', count(*) FROM "Profile"
//   UNION ALL SELECT 'EventType team/parent', count(*) FROM "EventType" WHERE "teamId" IS NOT NULL OR "parentId" IS NOT NULL
//   UNION ALL SELECT 'users with org', count(*) FROM users WHERE "organizationId" IS NOT NULL;   -- all 0
//   SELECT 'HostGroup (report)', count(*) FROM "HostGroup";
