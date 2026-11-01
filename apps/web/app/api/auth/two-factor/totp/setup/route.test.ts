import { beforeEach, describe, expect, it, vi } from "vitest";

// Flowko U14: the authenticator app lists the account under "Flowko", not "Cal".

const mocks = vi.hoisted(() => ({
  keyuri: vi.fn(() => "otpauth://totp/x"),
}));

vi.mock("app/api/defaultResponderForAppDir", () => ({ defaultResponderForAppDir: (handler: unknown) => handler }));
vi.mock("app/api/parseRequestData", () => ({ parseRequestData: async () => ({ password: "pw" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({}), headers: async () => new Headers() }));
vi.mock("otplib", () => ({
  authenticator: { generateSecret: () => "SECRET", keyuri: mocks.keyuri },
}));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,AA" } }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: async () => ({ user: { id: 7 } }),
}));
vi.mock("@calcom/features/auth/lib/verifyPassword", () => ({ verifyPassword: async () => true }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: async () => {} }));
vi.mock("@calcom/lib/crypto", () => ({ symmetricEncrypt: () => "encrypted" }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: () => ({}) }));
vi.mock("@calcom/prisma", () => ({
  default: {
    user: {
      findUnique: async () => ({
        id: 7,
        email: "host@example.com",
        identityProvider: "CAL",
        twoFactorEnabled: false,
        password: { hash: "h" },
      }),
      update: async () => ({}),
    },
  },
}));

import { POST } from "./route";

describe("TOTP setup", () => {
  beforeEach(() => {
    vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "k".repeat(32));
    mocks.keyuri.mockClear();
  });

  it("names the authenticator entry Flowko", async () => {
    await (POST as unknown as (req: unknown) => Promise<Response>)({});
    expect(mocks.keyuri).toHaveBeenCalledWith("host@example.com", "Flowko", "SECRET");
  });
});
