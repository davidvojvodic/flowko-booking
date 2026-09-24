import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { createHmac } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";

const mocks = vi.hoisted(() => ({
  createOAuthAppCredential: vi.fn(),
}));

vi.mock("../../_utils/getAppKeysFromSlug", () => ({
  default: vi.fn().mockResolvedValue({ client_id: "client-id", client_secret: "client-secret" }),
}));

vi.mock("../../_utils/oauth/createOAuthAppCredential", () => ({
  default: mocks.createOAuthAppCredential,
}));

const SECRET = "test-nextauth-secret";
const VICTIM_ID = 1;
const ATTACKER_ID = 2;

// The state the connect button produces for this user, through the add route's encodeOAuthState
function stateFromAdd(userId: number) {
  const { req } = createMocks<NextApiRequest, NextApiResponse>({ method: "GET", query: {} });
  req.session = { user: { id: userId } } as NextApiRequest["session"];
  return encodeOAuthState(req);
}

async function callCallback(query: Record<string, string>) {
  const { default: handler } = await import("./callback");
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: "GET", query });
  req.session = { user: { id: VICTIM_ID } } as NextApiRequest["session"];
  await handler(req, res);
  return res as unknown as NextApiResponse & {
    _getStatusCode: () => number;
    _getJSONData: () => { message: string };
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith("/auth/eagle/token")
      ? { status: 200, json: async () => ({ access_token: "attacker-access-token" }) }
      : { status: 200, json: async () => ({ id: "5" }) }
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("intercom callback: OAuth state", () => {
  it("refuses a code that arrives without a state, before redeeming it", async () => {
    const res = await callCallback({ code: "attacker-code" });

    expect(res._getStatusCode()).toBe(403);
    expect(res._getJSONData().message).toBe("Invalid OAuth state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.credential.deleteMany).not.toHaveBeenCalled();
    expect(mocks.createOAuthAppCredential).not.toHaveBeenCalled();
  });

  it("refuses a state signed for another user, before redeeming the code", async () => {
    const nonce = "attacker-nonce";
    const state = JSON.stringify({
      nonce,
      nonceHash: createHmac("sha256", SECRET).update(`${nonce}:${ATTACKER_ID}`).digest("hex"),
    });

    const res = await callCallback({ code: "attacker-code", state });

    expect(res._getStatusCode()).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.createOAuthAppCredential).not.toHaveBeenCalled();
  });

  it("connects the caller's own flow and replaces only the caller's earlier Intercom credential", async () => {
    const res = await callCallback({ code: "own-code", state: stateFromAdd(VICTIM_ID) });

    expect(res._getStatusCode()).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.credential.deleteMany).toHaveBeenCalledWith({
      where: { userId: VICTIM_ID, type: "intercom_automation", key: { string_contains: "5" } },
    });
    expect(mocks.createOAuthAppCredential).toHaveBeenCalledTimes(1);
  });
});
