// @vitest-environment node
import type { IncomingMessage } from "node:http";
import process from "node:process";
import type { Header } from "next/dist/lib/load-custom-routes";
import { checkCustomRoutes } from "next/dist/lib/load-custom-routes";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";
import { compileNonPath, matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { isReservedUsername } from "@calcom/features/auth/signup/utils/reservedUsernames";

/**
 * Flowko (U13a, U13-08): framing protection. Evaluates the real `headers()` of next.config.ts with
 * Next.js's own route matcher (`buildCustomRoute`, as the router server builds it) and applies the
 * matches the way `resolve-routes` does: every matching entry in order, a later entry overwriting the
 * same key, then `res.setHeader` (case-insensitive) in insertion order.
 */

let rawHeaders: Header[];
let headerRoutes: ReturnType<typeof buildCustomRoute<Header>>[];

beforeAll(async () => {
  // next.config.ts refuses to load without these; dummy values, nothing is signed or encrypted here.
  vi.stubEnv("NEXTAUTH_SECRET", "unit-test-only");
  vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "unit-test-only");
  vi.stubEnv("NEXTAUTH_URL", "https://booking.example.com/api/auth");
  vi.stubEnv("ORGANIZATIONS_ENABLED", "");
  vi.stubEnv("NEXT_PUBLIC_SINGLE_ORG_SLUG", "");
  const { default: buildConfig } = await import("./next.config");
  const config = buildConfig("phase-production-build");
  if (!config.headers) throw new Error("next.config.ts has no headers()");
  rawHeaders = await config.headers();
  headerRoutes = rawHeaders.map((route) => buildCustomRoute("header", route));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function resolveResponseHeaders(pathname: string, host = "booking.flowko.si"): Record<string, string> {
  const req = { headers: { host } } as unknown as IncomingMessage;
  const resHeaders: Record<string, string> = {};
  for (const route of headerRoutes) {
    let params = route.match(pathname);
    if (params && (route.has || route.missing)) {
      const hasParams = matchHas(req, {}, route.has, route.missing);
      params = hasParams ? { ...params, ...hasParams } : false;
    }
    if (!params) continue;
    const hasParams = Object.keys(params).length > 0;
    for (const header of route.headers) {
      const key = hasParams ? compileNonPath(header.key, params) : header.key;
      const value = hasParams ? compileNonPath(header.value, params) : header.value;
      resHeaders[key] = value;
    }
  }
  const sent: Record<string, string> = {};
  for (const [key, value] of Object.entries(resHeaders)) {
    sent[key.toLowerCase()] = value;
  }
  return sent;
}

const LOCKED = { xfo: "SAMEORIGIN", csp: "frame-ancestors 'self'" };
const DENIED = { xfo: "DENY", csp: "frame-ancestors 'none'" };

function framing(pathname: string): { xfo: string | undefined; csp: string | undefined } {
  const sent = resolveResponseHeaders(pathname);
  return { xfo: sent["x-frame-options"], csp: sent["content-security-policy"] };
}

describe("next.config headers(): framing protection (U13-08)", () => {
  it("passes Next.js's own custom-route validation (parse, 4096-char regex limit)", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`checkCustomRoutes called process.exit(${code})`);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => checkCustomRoutes(rawHeaders, "header")).not.toThrow();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      errors.mockRestore();
    }
  });

  it.each([
    // the matrix from the plan
    "/event-types",
    "/settings/admin/flags",
    "/apps/installed/calendar",
    "/flowko-test",
    "/flowko-test/ogled",
    "/booking/abc",
    "/reschedule/abc",
    // more dashboard and public pages
    "/",
    "/event-types/12",
    "/bookings/upcoming",
    "/settings/my-account/general",
    "/settings/admin/flags/",
    "/availability",
    "/availability/3",
    "/apps/google-calendar",
    "/getting-started",
    "/onboarding/getting-started",
    "/booking-successful/abc",
    "/booking/abc/logs",
    "/d/abc123/ogled",
    "/api/auth/session",
    "/api/integrations/googlecalendar/callback",
    "/sl/event-types",
    "/en/flowko-test/ogled",
    // dashboard routes whose last dynamic segment could be "embed"
    "/getting-started/embed",
    "/getting-started/x/embed",
    "/apps/installation/embed",
    "/apps/embed",
    "/apps/installed/embed",
    "/event-types/embed",
    "/bookings/embed",
    "/availability/embed",
    "/settings/admin/embed",
    "/settings/admin/apps/embed",
    "/onboarding/embed",
    "/video/embed",
    "/payment/embed",
    "/booking-successful/embed",
    "/booking/abc/logs/embed",
    // the locale rewrite turns /sl/getting-started/embed into /getting-started/embed
    "/sl/getting-started/embed",
    "/sl/apps/embed",
    "/SL/getting-started/embed",
    "/zh-CN/getting-started/embed",
    // a locale-prefixed embed path: embed.js never requests one, and the prefix hides what follows
    "/sl/flowko-test/ogled/embed",
    "/sl/flowko-test/embed",
    // private links have no embed route
    "/d/abc/embed",
    "/d/abc/ogled/embed",
    // rewrite-only prefixes and other shapes that are no embed route
    "/routing/forms/embed",
    "/router/embed",
    "/forms/abc/embed",
    "/success/embed",
    "/cancel/abc/embed",
    "/embed",
    "/booking/embed",
    "/reschedule/embed",
    "/flowko-test/ogled/extra/embed",
    "/flowko-test/ogled/embedded",
    "/flowko-test/ogled/embed/extra",
    "/flowko-test/embed-x",
    "/embedx/y",
    "/embed.jsx",
    "//flowko-test/embed",
    // percent-encoded paths that Next.js serves from the decoded static route
    "/%73ettings/admin/flags",
    "/%61pps/installed/calendar",
    // Flowko (U13 hardening): only the app's own Embed dialog frames the preview page
    "/embed/preview.html",
    "/embed/preview.html/",
    "/embed/PREVIEW.html",
    "/embed/preview.js",
    // Next.js serves a public file under its percent-decoded path too
    "/embed/%70review.html",
    "/embed/preview%2Ehtml",
    // the default locale prefix, under which Next.js still serves public files
    "/en/embed/preview.html",
    "/sl/embed/preview.html",
    // no /embed/* file: served by the /[user]/[type] booking page of a user named "embed"
    "/embed/",
    "/embed/ogled",
    "/EMBED/ogled",
    "/embed/ogled/extra",
    "/embed/embed.jsx",
    "/embed/embed.js/extra",
    "/embed/x/embed.js",
  ])("locks %s to this origin", (pathname) => {
    expect(framing(pathname)).toEqual(LOCKED);
  });

  it.each([
    "/flowko-test/embed",
    "/flowko-test/ogled/embed",
    "/flowko-test/ogled/embed/",
    "/booking/abc/embed",
    "/reschedule/abc/embed",
    "/embed/embed.js",
    "/embed/embed.js/",
    "/embed.js",
    // real username and slug shapes
    "/zobozdravnik-novak/pregled-30min/embed",
    "/user.name/type_1/embed",
    "/alice+bob/embed",
    "/flowko-test/pregled-%C4%8Deljusti/embed",
    "/Flowko-Test/Ogled/embed",
    // usernames that only start like a reserved route
    "/apps2/ogled/embed",
    "/authority/embed",
    "/slovenija/ogled/embed",
    "/dental/ogled/embed",
    "/booker/ogled/embed",
  ])("leaves %s frameable by any site", (pathname) => {
    expect(framing(pathname)).toEqual({ xfo: undefined, csp: undefined });
  });

  it.each([
    "/auth/login",
    "/auth/login/",
    "/auth",
    "/auth/error",
    "/auth/forgot-password/abc",
    "/auth/logout",
    "/signup",
    "/login",
    "/sl/auth/login",
    "/en/signup",
    "/sl/login",
    "/pt-BR/auth/logout",
    // /auth/* stays DENY even for a shape the embed exemption would otherwise match
    "/auth/x/embed",
  ])("denies all framing of %s", (pathname) => {
    expect(framing(pathname)).toEqual(DENIED);
  });

  it("spells each framing header key one way, so a later entry replaces an earlier one", () => {
    const framingKeys = rawHeaders.flatMap((route) =>
      route.headers
        .map((header) => header.key)
        .filter((key) => ["x-frame-options", "content-security-policy"].includes(key.toLowerCase()))
    );
    expect(new Set(framingKeys)).toEqual(new Set(["X-Frame-Options", "Content-Security-Policy"]));
  });

  it("fails the build when the route scan misses the dashboard routes", async () => {
    vi.resetModules();
    vi.doMock("./pagesAndRewritePaths", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./pagesAndRewritePaths")>()),
      topLevelRoutesExcludedFromOrgRewrite: ["router", "api"],
    }));
    try {
      const { default: buildConfig } = await import("./next.config");
      const config = buildConfig("phase-production-build");
      await expect(config.headers?.()).rejects.toThrow(/route scan .* found no settings, event-types, apps/);
    } finally {
      vi.doUnmock("./pagesAndRewritePaths");
      vi.resetModules();
    }
  });

  it("keeps upstream's other headers", () => {
    expect(resolveResponseHeaders("/event-types")).toMatchObject({
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    expect(resolveResponseHeaders("/flowko-test/ogled/embed")).toMatchObject({
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "cross-origin",
    });
    expect(resolveResponseHeaders("/embed/embed.js")).toMatchObject({
      "cross-origin-resource-policy": "cross-origin",
    });
    expect(resolveResponseHeaders("/auth/login")).toMatchObject({
      "x-content-type-options": "nosniff",
    });
  });
});

describe("next.config headers(): HSTS (U13-18)", () => {
  it.each([
    "/",
    "/event-types",
    "/settings/admin/flags",
    "/flowko-test/ogled",
    "/flowko-test/ogled/embed",
    "/booking/abc/embed",
    "/embed/embed.js",
    "/embed/preview.html",
    "/embed.js",
    "/auth/login",
    "/signup",
    "/api/auth/session",
    "/api/book/event",
    "/_next/static/chunks/main.js",
    "/icons/sprite.svg",
  ])("sends Strict-Transport-Security on %s", (pathname) => {
    expect(resolveResponseHeaders(pathname)["strict-transport-security"]).toBe("max-age=31536000");
  });

  it("sets it in one entry, without includeSubDomains or preload", () => {
    const hsts = rawHeaders.flatMap((route) =>
      route.headers
        .filter((header) => header.key.toLowerCase() === "strict-transport-security")
        .map((header) => ({ source: route.source, value: header.value }))
    );
    expect(hsts).toEqual([{ source: "/:path*", value: "max-age=31536000" }]);
  });
});

describe("reserved usernames follow the framing lock (U13 hardening)", () => {
  // The lock's first-segment list comes from a route scan at build time; the username check can't run that
  // scan, so it keeps a static list. A new top-level route fails here until reservedUsernames.ts has it.
  function lockedFirstSegments(): string[] {
    const locked = rawHeaders.find((route) =>
      route.headers.some((header) => header.key === "X-Frame-Options" && header.value === "SAMEORIGIN")
    );
    const list = locked?.source.match(/\(\?!\(\?:(.+?)\)\/\)/)?.[1];
    if (!list) throw new Error("no first-segment lookahead in the locked framing entry");
    return list.split("|").map((name) => name.replace(/\\(.)/g, "$1"));
  }

  it("finds the scanned routes, the virtual routes and the locales in the lock", () => {
    expect(lockedFirstSegments()).toEqual(
      expect.arrayContaining([
        "settings",
        "event-types",
        "apps",
        "booking",
        "reschedule",
        "embed",
        "sl",
        "pt-BR",
      ])
    );
  });

  it("refuses as a username every first segment the lock treats as a route", () => {
    expect(lockedFirstSegments().filter((name) => !isReservedUsername(name))).toEqual([]);
  });
});
