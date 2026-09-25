import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";

import { decodeOAuthState } from "../../_utils/oauth/decodeOAuthState";

const mocks = vi.hoisted(() => ({
  generateAuthUrl: vi.fn(),
}));

vi.mock("googleapis-common", () => ({
  OAuth2Client: vi.fn().mockImplementation(function () {
    return { generateAuthUrl: mocks.generateAuthUrl };
  }),
}));

vi.mock("../lib/getGoogleAppKeys", () => ({
  getGoogleAppKeys: vi.fn().mockResolvedValue({ client_id: "client-id", client_secret: "client-secret" }),
}));

async function callAdd(query: Record<string, string>, headers: Record<string, string> = {}) {
  const { default: handler } = await import("./add");
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "GET", query, headers });
  req.session = { user: { id: 1, email: "owner@example.com" } } as NextApiRequest["session"];
  await handler(req, res);
  return {
    req,
    res: res as unknown as NextApiResponse & {
      _getStatusCode: () => number;
      _getJSONData: () => { message?: string; url?: string };
    },
  };
}

beforeEach(() => {
  stubTestCredentialKeyring();
  mocks.generateAuthUrl.mockImplementation(
    ({ state }: { state?: string }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("googlecalendar add", () => {
  it("refuses to start the flow when NEXTAUTH_SECRET is missing, as the state can't be signed", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");

    const { res } = await callAdd({ state: JSON.stringify({ fromApp: true }) });

    expect(res._getStatusCode()).toBe(500);
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("sends Google a state signed for this user even when the client sent none", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-nextauth-secret");

    const { req, res } = await callAdd({});

    expect(res._getStatusCode()).toBe(200);
    const { state } = mocks.generateAuthUrl.mock.calls[0][0];
    expect(state).toEqual(expect.any(String));
    req.query.state = state;
    expect(decodeOAuthState(req)).toEqual(expect.objectContaining({ nonce: expect.any(String) }));
  });
});

describe("googlecalendar add: credential keyring", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-nextauth-secret");
  });

  it("answers 503 with no auth URL when the credential keyring is not configured", async () => {
    stubMissingCredentialKeyring();

    const { res } = await callAdd({ state: JSON.stringify({ fromApp: true }) });

    expect(res._getStatusCode()).toBe(503);
    expect(res._getJSONData().message).toBe(
      "Calendar connections are unavailable right now. Please try again later."
    );
    expect(res._getJSONData().url).toBeUndefined();
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("answers 503 when CURRENT names a kid whose key is missing", async () => {
    vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_CURRENT", "KMISSING");
    vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_KMISSING", "");

    const { res } = await callAdd({});

    expect(res._getStatusCode()).toBe(503);
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("tells a Slovenian user in Slovenian, since the connect button shows the message as it is", async () => {
    stubMissingCredentialKeyring();

    const { res } = await callAdd({}, { "accept-language": "sl-SI,sl;q=0.9,en;q=0.8" });

    expect(res._getStatusCode()).toBe(503);
    expect(res._getJSONData().message).toBe(
      "Povezovanje koledarjev trenutno ni na voljo. Poskusite znova pozneje."
    );
  });

  it("still returns Google's auth URL with a configured keyring", async () => {
    const { res } = await callAdd({});

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().url).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(mocks.generateAuthUrl).toHaveBeenCalledTimes(1);
  });
});
