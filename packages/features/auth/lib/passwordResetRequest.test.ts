import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendPasswordResetEmail = vi.fn();

vi.mock("@calcom/prisma", () => {
  const mockPrisma = {
    resetPasswordRequest: {
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});
vi.mock("@calcom/i18n/server", () => ({
  getTranslation: vi.fn(async () => (key: string) => key),
}));
vi.mock("@calcom/emails/auth-email-service", () => ({
  sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
}));

import prisma from "@calcom/prisma";

import { generatePasswordResetRequestId, passwordResetRequest } from "./passwordResetRequest";

const HEX_256_BITS = /^[0-9a-f]{64}$/;
const user = { email: "owner@example.com", name: "Owner", locale: "en" };

describe("passwordResetRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00.000Z"));
    vi.mocked(prisma.resetPasswordRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.resetPasswordRequest.create).mockImplementation((async (args: {
      data: { id?: string; email: string; expires: Date };
    }) => ({ ...args.data, id: args.data.id ?? "c-prisma-default-cuid" })) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a crypto-random id rather than leaving it to Prisma's cuid()", async () => {
    await passwordResetRequest(user);

    const { data } = vi.mocked(prisma.resetPasswordRequest.create).mock.calls[0][0];
    expect(data.id).toMatch(HEX_256_BITS);
  });

  it("gives two requests for the same email in the same millisecond different ids", async () => {
    await passwordResetRequest(user);
    await passwordResetRequest(user);

    const ids = vi.mocked(prisma.resetPasswordRequest.create).mock.calls.map(([args]) => args.data.id);
    expect(ids[0]).toMatch(HEX_256_BITS);
    expect(ids[1]).toMatch(HEX_256_BITS);
    expect(ids[0]).not.toEqual(ids[1]);
  });

  it("emails the link with the stored id", async () => {
    await passwordResetRequest(user);

    const { data } = vi.mocked(prisma.resetPasswordRequest.create).mock.calls[0][0];
    const { resetLink } = mockSendPasswordResetEmail.mock.calls[0][0];
    expect(resetLink).toMatch(new RegExp(`/auth/forgot-password/${data.id}$`));
  });
});

describe("generatePasswordResetRequestId", () => {
  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePasswordResetRequestId()));

    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(HEX_256_BITS);
  });
});
