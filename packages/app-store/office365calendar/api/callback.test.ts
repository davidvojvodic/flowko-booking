import { createHmac } from "node:crypto";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { Prisma } from "@calcom/prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialCreate: vi.fn(),
  credentialDelete: vi.fn(),
  selectedCalendarCreate: vi.fn(),
  renewSelectedCalendarCredentialId: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@calcom/prisma", () => {
  const prisma = {
    credential: { create: mocks.credentialCreate, delete: mocks.credentialDelete },
    selectedCalendar: { create: mocks.selectedCalendarCreate },
  };
  return { default: prisma, prisma };
});

vi.mock("@calcom/lib/connectedCalendar", () => ({
  renewSelectedCalendarCredentialId: mocks.renewSelectedCalendarCredentialId,
}));

vi.mock("@calcom/lib/logger", () => {
  const log = { info: mocks.logInfo, warn: mocks.logWarn, error: mocks.logError, debug: vi.fn() };
  return { default: { ...log, getSubLogger: () => log } };
});

vi.mock("../../_utils/getAppKeysFromSlug", () => ({
  default: vi.fn().mockResolvedValue({ client_id: "client-id", client_secret: "client-secret" }),
}));

const SECRET = "test-nextauth-secret";
const USER_ID = 7;
const INSTALLED_CALENDARS = `${WEBAPP_URL}/apps/installed/calendar?hl=office365-calendar`;

// Microsoft identity platform's answer to a refused token request: provider internals, never shown to anyone
const REFUSED_TOKEN_BODY = {
  error: "invalid_grant",
  error_description:
    "AADSTS70008: The provided authorization code or refresh token has expired. Trace ID: 0000-trace Correlation ID: 0000-correlation",
  error_codes: [70008],
  trace_id: "0000-trace",
  correlation_id: "0000-correlation",
};

function signedState(state: Record<string, unknown> = {}) {
  const nonce = "test-nonce";
  return JSON.stringify({
    ...state,
    nonce,
    nonceHash: createHmac("sha256", SECRET).update(`${nonce}:${USER_ID}`).digest("hex"),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockMicrosoft({
  tokenStatus = 200,
  tokenBody = { access_token: "access", refresh_token: "refresh", expires_in: 3600 } as unknown,
  calendars = [{ id: "calendar-1", isDefaultCalendar: true }] as Array<Record<string, unknown>>,
} = {}) {
  mocks.fetch.mockImplementation(async (input: string) => {
    const url = String(input);
    if (url.startsWith("https://login.microsoftonline.com/")) return jsonResponse(tokenBody, tokenStatus);
    if (url === "https://graph.microsoft.com/v1.0/me") return jsonResponse({ mail: "host@example.com" });
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/calendars"))
      return jsonResponse({ value: calendars });
    throw new Error(`Unexpected fetch ${url}`);
  });
}

async function callCallback(state?: Record<string, unknown>) {
  const { default: handler } = await import("./callback");
  const query: Record<string, string> = { code: "auth-code" };
  if (state) query.state = signedState(state);
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "GET", query });
  req.session = { user: { id: USER_ID } } as NextApiRequest["session"];
  await handler(req, res);
  return res as unknown as NextApiResponse & {
    _getStatusCode: () => number;
    _getRedirectUrl: () => string;
  };
}

function redirectUrl(res: { _getRedirectUrl: () => string }) {
  return new URL(res._getRedirectUrl());
}

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  vi.stubGlobal("fetch", mocks.fetch);
  mockMicrosoft();
  mocks.credentialCreate.mockImplementation(async ({ data }: { data: object }) => ({ id: 10, ...data }));
  mocks.credentialDelete.mockResolvedValue(undefined);
  mocks.selectedCalendarCreate.mockResolvedValue(undefined);
  mocks.renewSelectedCalendarCredentialId.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("office365calendar callback (Flowko): a refused token request", () => {
  it("redirects with a fixed error key and none of Microsoft's error body", async () => {
    mockMicrosoft({ tokenStatus: 400, tokenBody: REFUSED_TOKEN_BODY });

    const res = await callCallback();

    expect(res._getStatusCode()).toBe(302);
    const url = redirectUrl(res);
    expect(`${url.origin}${url.pathname}`).toBe(`${WEBAPP_URL}/apps/installed/calendar`);
    expect(url.searchParams.get("hl")).toBe("office365-calendar");
    expect(url.searchParams.get("error")).toBe("something_went_wrong");
    expect(res._getRedirectUrl()).not.toMatch(/AADSTS|trace|correlation|invalid_grant|%7B|\{/i);
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("goes back to the page that started the connect", async () => {
    mockMicrosoft({ tokenStatus: 400, tokenBody: REFUSED_TOKEN_BODY });

    const res = await callCallback({ onErrorReturnTo: `${WEBAPP_URL}/settings/my-account/calendars` });

    expect(res._getRedirectUrl()).toBe(
      `${WEBAPP_URL}/settings/my-account/calendars?error=something_went_wrong`
    );
  });

  it("logs only the status and the OAuth error code, never the body", async () => {
    mockMicrosoft({ tokenStatus: 400, tokenBody: REFUSED_TOKEN_BODY });

    await callCallback();

    expect(mocks.logWarn).toHaveBeenCalledWith(expect.any(String), {
      userId: USER_ID,
      status: 400,
      error: "invalid_grant",
    });
    const logged = JSON.stringify([
      mocks.logInfo.mock.calls,
      mocks.logWarn.mock.calls,
      mocks.logError.mock.calls,
    ]);
    expect(logged).not.toMatch(/AADSTS|0000-trace|0000-correlation/);
  });

  it.each([
    ["not a string", { error: { nested: "x" } }],
    ["free text", { error: "Invalid grant: see AADSTS70008" }],
    ["missing", {}],
  ])("logs an OAuth error code that is %s as unknown", async (_label, tokenBody) => {
    mockMicrosoft({ tokenStatus: 401, tokenBody });

    await callCallback();

    expect(mocks.logWarn).toHaveBeenCalledWith(expect.any(String), {
      userId: USER_ID,
      status: 401,
      error: "unknown",
    });
  });
});

describe("office365calendar callback (Flowko): ?error= is set with the URL API", () => {
  it("keeps hl on the installed calendars when no default calendar is found", async () => {
    mockMicrosoft({ calendars: [{ id: "calendar-1", isDefaultCalendar: false }] });

    const res = await callCallback();

    const url = redirectUrl(res);
    expect(`${url.origin}${url.pathname}`).toBe(`${WEBAPP_URL}/apps/installed/calendar`);
    expect(url.searchParams.get("hl")).toBe("office365-calendar");
    expect(url.searchParams.get("error")).toBe("no_default_calendar");
    expect(mocks.credentialCreate).not.toHaveBeenCalled();
  });

  it("replaces an earlier ?error= and keeps the other parameters of the page that started the connect", async () => {
    mockMicrosoft({ calendars: [] });

    const res = await callCallback({
      onErrorReturnTo: `${WEBAPP_URL}/settings/my-account/calendars?tab=1&error=account_already_linked`,
    });

    const url = redirectUrl(res);
    expect(url.pathname).toBe("/settings/my-account/calendars");
    expect(url.searchParams.get("tab")).toBe("1");
    expect(url.searchParams.getAll("error")).toEqual(["no_default_calendar"]);
  });

  it("treats a relative onErrorReturnTo as missing instead of failing", async () => {
    mockMicrosoft({ calendars: [] });

    const res = await callCallback({ onErrorReturnTo: "/settings/my-account/calendars" });

    expect(res._getStatusCode()).toBe(302);
    expect(res._getRedirectUrl()).toBe(`${INSTALLED_CALENDARS}&error=no_default_calendar`);
  });

  it("never leaves this app for a foreign onErrorReturnTo", async () => {
    mockMicrosoft({ calendars: [] });

    const res = await callCallback({ onErrorReturnTo: "https://attacker.example.com/phish" });

    expect(redirectUrl(res).origin).toBe(new URL(WEBAPP_URL).origin);
    expect(redirectUrl(res).searchParams.get("error")).toBe("no_default_calendar");
  });

  it("deletes the credential and keeps hl when the selected calendar can't be stored", async () => {
    mocks.selectedCalendarCreate.mockRejectedValue(new Error("database unavailable"));

    const res = await callCallback();

    expect(mocks.credentialDelete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(res._getRedirectUrl()).toBe(`${INSTALLED_CALENDARS}&error=something_went_wrong`);
  });

  it("answers account_already_linked for a selected calendar held by another credential", async () => {
    mocks.selectedCalendarCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    const res = await callCallback({ onErrorReturnTo: `${WEBAPP_URL}/apps/installed/calendar?hl=x` });

    expect(mocks.credentialDelete).toHaveBeenCalledWith({ where: { id: 10 } });
    const url = redirectUrl(res);
    expect(url.searchParams.get("hl")).toBe("x");
    expect(url.searchParams.get("error")).toBe("account_already_linked");
  });

  it("still redirects a successful connect to the installed calendars without an error", async () => {
    const res = await callCallback();

    expect(mocks.credentialCreate).toHaveBeenCalledTimes(1);
    expect(mocks.selectedCalendarCreate).toHaveBeenCalledTimes(1);
    expect(res._getRedirectUrl()).toBe("/apps/installed/calendar?hl=office365-calendar");
  });
});
