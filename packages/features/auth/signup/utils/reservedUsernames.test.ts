import { describe, expect, it } from "vitest";
import { isReservedUsername, RESERVED_USERNAMES } from "./reservedUsernames";

// Flowko (U13 hardening). The list is checked against next.config.ts's framing lock, which scans the routes
// at build time, in apps/web/next.config.headers.test.ts.
describe("isReservedUsername", () => {
  it.each([
    // the static embed files and the embed route segment
    "embed",
    "embed.js",
    // the routes the task names
    "booking",
    "reschedule",
    "api",
    "auth",
    "apps",
    "settings",
    // more dashboard and public routes
    "event-types",
    "bookings",
    "availability",
    "getting-started",
    "onboarding",
    "d",
    "video",
    "signup",
    "login",
    "router",
    "routing-forms",
    "_next",
    "public",
    "org",
    "team",
    "support",
    // locales, without case (Next.js matches routes without case)
    "sl",
    "en",
    "pt-br",
    "zh-CN",
    "es-419",
    "sk-sk",
    // without case, with surrounding whitespace
    "EMBED",
    "Settings",
    " apps ",
    // names ending in "embed": embed.js adds no /embed to such a link
    "studio-embed",
    "studioembed",
    "x.embed",
  ])("refuses %j", (username) => {
    expect(isReservedUsername(username)).toBe(true);
  });

  it.each([
    "flowko-test",
    "zobozdravnik-novak",
    "david",
    "embedded",
    "embed-studio",
    "embedx",
    "apps2",
    "authority",
    "slovenija",
    "dental",
    "booker",
    "settings-studio",
    "sl-studio",
    "teams-dental",
    "bookingstudio",
  ])("allows %j", (username) => {
    expect(isReservedUsername(username)).toBe(false);
  });

  it("treats a missing or blank username as not reserved (other checks refuse it)", () => {
    expect(isReservedUsername(undefined)).toBe(false);
    expect(isReservedUsername(null)).toBe(false);
    expect(isReservedUsername("")).toBe(false);
    expect(isReservedUsername("   ")).toBe(false);
  });

  it("stores every name in lower case", () => {
    for (const name of Array.from(RESERVED_USERNAMES)) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});
