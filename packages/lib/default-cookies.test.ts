import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCookies } from "./default-cookies";

// Flowko U13-09: every NextAuth cookie is SameSite=Lax, on HTTPS (production) as in development
describe("defaultCookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const cookieKeys = [
    "sessionToken",
    "callbackUrl",
    "csrfToken",
    "pkceCodeVerifier",
    "state",
    "nonce",
  ] as const;

  it("defines exactly the NextAuth cookies it always did", () => {
    expect(Object.keys(defaultCookies(true)).sort()).toEqual([...cookieKeys].sort());
  });

  it.each(cookieKeys)("sets %s to SameSite=Lax, Secure and __Secure- on HTTPS", (key) => {
    const cookie = defaultCookies(true)[key];
    expect(cookie?.options.sameSite).toBe("lax");
    expect(cookie?.options.secure).toBe(true);
    expect(cookie?.options.path).toBe("/");
    expect(cookie?.name.startsWith("__Secure-next-auth.")).toBe(true);
  });

  it.each(cookieKeys)("keeps %s at SameSite=Lax without Secure on plain HTTP (development)", (key) => {
    const cookie = defaultCookies(false)[key];
    expect(cookie?.options.sameSite).toBe("lax");
    expect(cookie?.options.secure).toBe(false);
    expect(cookie?.name.startsWith("next-auth.")).toBe(true);
  });

  it("sets no cookie to SameSite=None in either mode", () => {
    for (const secure of [true, false]) {
      for (const cookie of Object.values(defaultCookies(secure))) {
        expect(cookie.options.sameSite).not.toBe("none");
      }
    }
  });

  it("keeps httpOnly on the session, CSRF, PKCE, state and nonce cookies and off on the callback URL", () => {
    const cookies = defaultCookies(true);
    expect(cookies.sessionToken?.options.httpOnly).toBe(true);
    expect(cookies.csrfToken?.options.httpOnly).toBe(true);
    expect(cookies.pkceCodeVerifier?.options.httpOnly).toBe(true);
    expect(cookies.state?.options.httpOnly).toBe(true);
    expect(cookies.nonce?.options.httpOnly).toBe(true);
    expect(cookies.callbackUrl?.options.httpOnly).toBeUndefined();
  });

  it("still applies NEXTAUTH_COOKIE_DOMAIN to the cookies that carried it before", async () => {
    vi.stubEnv("NEXTAUTH_COOKIE_DOMAIN", ".example.com");
    vi.resetModules();
    const { defaultCookies: withDomain } = await import("./default-cookies");
    const cookies = withDomain(true);
    expect(cookies.sessionToken?.options.domain).toBe(".example.com");
    expect(cookies.csrfToken?.options.domain).toBe(".example.com");
    expect(cookies.sessionToken?.options.sameSite).toBe("lax");
    // The nonce cookie never carried the domain (upstream), and still doesn't
    expect(cookies.nonce?.options.domain).toBeUndefined();
  });
});
