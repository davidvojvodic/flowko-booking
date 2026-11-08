// Flowko U28: the /koledar route is pinned by source assertions (as calScreensPage.test.ts pins the Cal pages):
// the layout reads the session and requires desk access, the page renders the client wrapper and never calls
// next/dynamic itself (Next refuses `ssr: false` in a Server Component; only a build shows it).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const DIR = "apps/web/app/(use-page-wrapper)/(main-nav)/koledar";
const read = (file: string): string => readFileSync(resolve(ROOT, file), "utf8");

describe("koledar/layout.tsx", () => {
  const source = read(`${DIR}/layout.tsx`);

  it("reads the session, sends a missing one to the login, then requires desk access", () => {
    expect(source).toContain('import { requireDeskAccess } from "@lib/flowko/deskPage";');
    const sessionRead = source.indexOf("await getServerSession(");
    const loginRedirect = source.indexOf('redirect("/auth/login")');
    const guard = source.indexOf("await requireDeskAccess(session.user.id);");
    expect(sessionRead).toBeGreaterThan(-1);
    expect(loginRedirect).toBeGreaterThan(sessionRead);
    expect(guard).toBeGreaterThan(loginRedirect);
    expect(source.match(/requireDeskAccess\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\btry\s*\{/);
    expect(source).toContain("<>{children}</>");
  });
});

describe("koledar/page.tsx", () => {
  const source = read(`${DIR}/page.tsx`);

  it("renders the client wrapper and has no dynamic( of its own", () => {
    expect(source).not.toContain("dynamic(");
    expect(source).toContain("flowko-desk/desk-view-client");
    expect(source).toContain("flowko_desk_title");
    expect(source).toContain("flowko_desk_subtitle");
  });
});

describe("desk-view-client.tsx", () => {
  it('is a client module that loads the view with dynamic(..., { ssr: false })', () => {
    const source = read("apps/web/modules/flowko-desk/desk-view-client.tsx");
    expect(source.trimStart().startsWith("// Flowko U28:")).toBe(true);
    expect(source).toContain('"use client"');
    expect(source).toMatch(/dynamic\(\s*\(\) => import\("\.\/desk-view"\),\s*\{ ssr: false \}\s*\)/);
  });
});
