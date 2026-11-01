import { beforeEach, describe, expect, it, vi } from "vitest";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("next-auth/jwt", () => ({ getToken }));

import { getBrowserLocale, getLocale } from "./getLocale";

const request = (acceptLanguage?: string) =>
  ({
    cookies: {},
    headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
  }) as unknown as Parameters<typeof getLocale>[0];

// Flowko U14: signed out is always Slovene first; only an explicit „Jezik brskalnika obiskovalca“ asks the browser.
describe("getLocale", () => {
  beforeEach(() => {
    getToken.mockReset();
  });

  it("is Slovene without a token, whatever the browser asks for", async () => {
    getToken.mockResolvedValue(null);

    await expect(getLocale(request("en-US"))).resolves.toBe("sl");
    await expect(getLocale(request("de"))).resolves.toBe("sl");
    await expect(getLocale(request())).resolves.toBe("sl");
  });

  it("is Slovene for a token without a language", async () => {
    getToken.mockResolvedValue({ sub: "1" });

    await expect(getLocale(request("en-US"))).resolves.toBe("sl");
  });

  it("uses the token's language", async () => {
    getToken.mockResolvedValue({ locale: "en" });

    await expect(getLocale(request("sl"))).resolves.toBe("en");
  });
});

describe("getBrowserLocale", () => {
  it.each([
    ["en-US", "en"],
    ["en-GB,en;q=0.9,sl;q=0.8", "en"],
    ["sl-SI", "sl"],
    ["de-DE", "de"],
    ["es-419", "es"],
    ["pt-BR", "pt-BR"],
    ["*", "en"],
  ])("reads %s as %s, as upstream did", (header, expected) => {
    expect(getBrowserLocale(request(header))).toBe(expected);
  });

  it("is English without the header, as upstream was", () => {
    expect(getBrowserLocale(request())).toBe("en");
  });

  it("reads a Headers object too", () => {
    const req = { cookies: {}, headers: new Headers({ "accept-language": "en-US" }) };

    expect(getBrowserLocale(req as unknown as Parameters<typeof getBrowserLocale>[0])).toBe("en");
  });

  it("never asks for the session", () => {
    getToken.mockReset();

    getBrowserLocale(request("en"));

    expect(getToken).not.toHaveBeenCalled();
  });
});
