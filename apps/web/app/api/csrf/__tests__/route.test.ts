import { beforeEach, describe, expect, it, vi } from "vitest";

const constants = vi.hoisted(() => ({ WEBAPP_URL: "https://booking.example.com" }));

vi.mock("@calcom/lib/constants", () => constants);

import { GET } from "../route";

function getCookie(query = "") {
  return GET(new Request(`https://booking.example.com/api/csrf${query}`));
}

function setCookieHeader(res: Response) {
  const header = res.headers.get("set-cookie");
  expect(header).toBeTruthy();
  return header as string;
}

// Flowko: the calcom.csrf_token double-submit cookie is Lax. The cancel form, its only caller that asked for
// SameSite=None, runs first-party since U13-11
describe("GET /api/csrf", () => {
  beforeEach(() => {
    constants.WEBAPP_URL = "https://booking.example.com";
  });

  it.each(["", "?sameSite=none", "?sameSite=None", "?sameSite=lax", "?sameSite=anything"])(
    "sets a Lax cookie for %j",
    async (query) => {
      const res = await getCookie(query);
      const cookie = setCookieHeader(res);

      expect(cookie).toMatch(/^calcom\.csrf_token=[0-9a-f]{64};/);
      expect(cookie.toLowerCase()).toContain("samesite=lax");
      expect(cookie.toLowerCase()).not.toContain("samesite=none");
    }
  );

  it("still lets a caller tighten it to Strict", async () => {
    const cookie = setCookieHeader(await getCookie("?sameSite=strict"));

    expect(cookie.toLowerCase()).toContain("samesite=strict");
  });

  it("sets an HttpOnly, Secure session cookie for the whole site and returns the same token", async () => {
    const res = await getCookie();
    const cookie = setCookieHeader(res);
    const { csrfToken } = await res.json();

    expect(cookie).toContain(`calcom.csrf_token=${csrfToken};`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    // No Max-Age or Expires: the browser deletes it when it closes (and /api/cancel deletes it once it matched)
    expect(cookie).not.toMatch(/max-age|expires/i);
  });

  it("drops Secure on a plain-http instance (local development)", async () => {
    constants.WEBAPP_URL = "http://localhost:3000";

    const cookie = setCookieHeader(await getCookie("?sameSite=none"));

    expect(cookie).not.toContain("Secure");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });
});
