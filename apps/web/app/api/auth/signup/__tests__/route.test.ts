import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../route";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requestBody: {} as Record<string, unknown>,
    selfHostedSignupHandler: vi.fn(),
    calcomSignupHandler: vi.fn(),
    checkIfFeatureIsEnabledGlobally: vi.fn(),
  },
}));

vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (handler: (req: NextRequest) => Promise<Response>) =>
    (req: NextRequest, _context: { params: Promise<Record<string, string>> }) =>
      handler(req),
}));

vi.mock("app/api/parseRequestData", () => ({
  parseRequestData: vi.fn(() => Promise.resolve(mocks.requestBody)),
}));

vi.mock("next/server", async () => {
  const { createNextServerMock } = await import(
    "@calcom/features/auth/signup/handlers/__tests__/mocks/next.mocks"
  );
  return createNextServerMock();
});

vi.mock("../handlers/selfHostedHandler", () => ({ default: mocks.selfHostedSignupHandler }));
vi.mock("../handlers/calcomSignupHandler", () => ({ default: mocks.calcomSignupHandler }));

vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally(slug: string) {
      return mocks.checkIfFeatureIsEnabledGlobally(slug);
    }
  },
}));

vi.mock("@calcom/lib/constants", () => ({ IS_PREMIUM_USERNAME_ENABLED: false }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/lib/getIP", () => ({ default: () => "127.0.0.1" }));
vi.mock("@calcom/lib/server/PiiHasher", () => ({ piiHasher: { hash: (value: string) => value } }));
vi.mock("@calcom/lib/server/checkCfTurnstileToken", () => ({ checkCfTurnstileToken: vi.fn() }));
vi.mock("@calcom/lib/logger", () => ({ default: { error: vi.fn() } }));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));

const signupBody = {
  email: "someone@example.si",
  password: "Password1234!",
  username: "someone",
  token: "invite-token",
};

const callSignup = (body: Record<string, unknown>) => {
  mocks.requestBody = body;
  const req = {
    nextUrl: new URL("http://app.cal.local:3000/api/auth/signup"),
    headers: new Headers(),
  } as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({}) });
};

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkIfFeatureIsEnabledGlobally.mockResolvedValue(false);
    mocks.selfHostedSignupHandler.mockResolvedValue({ status: 201 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a signup with a token while NEXT_PUBLIC_DISABLE_SIGNUP is true", async () => {
    vi.stubEnv("NEXT_PUBLIC_DISABLE_SIGNUP", "true");

    const res = await callSignup(signupBody);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Signup is disabled" });
    expect(mocks.selfHostedSignupHandler).not.toHaveBeenCalled();
    expect(mocks.calcomSignupHandler).not.toHaveBeenCalled();
  });

  it("rejects a signup with a token while the disable-signup flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DISABLE_SIGNUP", "false");
    mocks.checkIfFeatureIsEnabledGlobally.mockImplementation((slug: string) =>
      Promise.resolve(slug === "disable-signup")
    );

    const res = await callSignup(signupBody);

    expect(res.status).toBe(403);
    expect(mocks.selfHostedSignupHandler).not.toHaveBeenCalled();
  });

  it("rejects a signup without a token while NEXT_PUBLIC_DISABLE_SIGNUP is true", async () => {
    vi.stubEnv("NEXT_PUBLIC_DISABLE_SIGNUP", "true");
    const { token: _token, ...bodyWithoutToken } = signupBody;

    const res = await callSignup(bodyWithoutToken);

    expect(res.status).toBe(403);
    expect(mocks.selfHostedSignupHandler).not.toHaveBeenCalled();
  });

  it("passes the signup to the handler while signup is open", async () => {
    vi.stubEnv("NEXT_PUBLIC_DISABLE_SIGNUP", "false");

    const res = await callSignup(signupBody);

    expect(res.status).toBe(201);
    expect(mocks.selfHostedSignupHandler).toHaveBeenCalledWith(signupBody);
  });
});
