import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeOAuthState } from "./decodeOAuthState";
import { encodeOAuthState } from "./encodeOAuthState";

function request({ userId, state }: { userId?: number; state?: string }) {
  const { req } = createMocks<NextApiRequest, NextApiResponse>({
    method: "GET",
    query: state === undefined ? {} : { state },
  });
  if (userId) req.session = { user: { id: userId } } as NextApiRequest["session"];
  return req;
}

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-nextauth-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encodeOAuthState", () => {
  it("signs a nonce for the user even when the client sent no state", () => {
    const encoded = encodeOAuthState(request({ userId: 1 }));

    expect(encoded).toEqual(expect.any(String));
    const state = JSON.parse(encoded as string);
    expect(state.nonce).toEqual(expect.any(String));
    expect(state.nonceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the client's state and adds the nonce", () => {
    const encoded = encodeOAuthState(
      request({ userId: 1, state: JSON.stringify({ fromApp: true, returnTo: "https://example.com/x" }) })
    );

    expect(JSON.parse(encoded as string)).toEqual(
      expect.objectContaining({ fromApp: true, returnTo: "https://example.com/x", nonce: expect.any(String) })
    );
  });

  it("produces a state that decodes for the same user only", () => {
    const encoded = encodeOAuthState(request({ userId: 1 })) as string;

    expect(decodeOAuthState(request({ userId: 1, state: encoded }))).toEqual(JSON.parse(encoded));
    expect(decodeOAuthState(request({ userId: 2, state: encoded }))).toBeUndefined();
    expect(decodeOAuthState(request({ state: encoded }))).toBeUndefined();
  });
});
