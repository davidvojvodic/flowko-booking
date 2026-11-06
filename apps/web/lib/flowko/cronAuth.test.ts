import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cronAuth";

// Flowko U22: the reminder cron's auth fails closed (R6, Review Focus 4).
const SECRET = `${"s".repeat(31)}S`; // 32 chars

const request = (url: string, authorization?: string) =>
  ({
    headers: new Headers(authorization === undefined ? {} : { authorization }),
    nextUrl: new URL(url),
  }) as unknown as NextRequest;

const URL_ = "http://localhost/api/cron/attendeeReminder";

describe("isAuthorizedCron", () => {
  it("is false when the secret is unset, even for `Bearer undefined`", () => {
    expect(isAuthorizedCron(request(URL_, "Bearer undefined"), undefined)).toBe(false);
    expect(isAuthorizedCron(request(URL_, "Bearer "), undefined)).toBe(false);
  });

  it("is false when the secret is empty, even for an empty Bearer", () => {
    expect(isAuthorizedCron(request(URL_, "Bearer "), "")).toBe(false);
    expect(isAuthorizedCron(request(URL_, "Bearer"), "")).toBe(false);
  });

  it("is false when the secret is shorter than 32 characters, even if the header matches", () => {
    const short = "x".repeat(31);
    expect(isAuthorizedCron(request(URL_, `Bearer ${short}`), short)).toBe(false);
  });

  it("is false for a wrong Bearer token", () => {
    expect(isAuthorizedCron(request(URL_, `Bearer ${"t".repeat(32)}`), SECRET)).toBe(false);
    expect(isAuthorizedCron(request(URL_, `Bearer ${SECRET}x`), SECRET)).toBe(false);
  });

  it("is false for Basic auth carrying the secret", () => {
    expect(isAuthorizedCron(request(URL_, `Basic ${SECRET}`), SECRET)).toBe(false);
  });

  it("is false for the raw secret without `Bearer`", () => {
    expect(isAuthorizedCron(request(URL_, SECRET), SECRET)).toBe(false);
  });

  it("is false for the secret in ?apiKey=", () => {
    expect(isAuthorizedCron(request(`${URL_}?apiKey=${SECRET}`), SECRET)).toBe(false);
  });

  it("is false with no Authorization header", () => {
    expect(isAuthorizedCron(request(URL_), SECRET)).toBe(false);
  });

  it("is true for the right Bearer token", () => {
    expect(isAuthorizedCron(request(URL_, `Bearer ${SECRET}`), SECRET)).toBe(true);
  });
});
