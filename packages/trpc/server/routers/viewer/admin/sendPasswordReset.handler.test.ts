import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendPasswordResetEmail = vi.fn();

vi.mock("@calcom/prisma", () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
    },
    resetPasswordRequest: {
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

import { prisma } from "@calcom/prisma";

import sendPasswordResetHandler from "./sendPasswordReset.handler";

const HEX_256_BITS = /^[0-9a-f]{64}$/;

describe("admin sendPasswordResetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: "Owner",
      email: "owner@example.com",
      locale: "en",
    } as never);
    vi.mocked(prisma.resetPasswordRequest.create).mockImplementation((async (args: {
      data: { id?: string; email: string; expires: Date };
    }) => ({ ...args.data, id: args.data.id ?? "c-prisma-default-cuid" })) as never);
  });

  const call = () =>
    sendPasswordResetHandler({
      ctx: { user: { id: 1, role: "ADMIN" } as never },
      input: { userId: 7 },
    });

  it("stores a crypto-random id rather than leaving it to Prisma's cuid()", async () => {
    await call();

    const { data } = vi.mocked(prisma.resetPasswordRequest.create).mock.calls[0][0];
    expect(data.id).toMatch(HEX_256_BITS);
    const { resetLink } = mockSendPasswordResetEmail.mock.calls[0][0];
    expect(resetLink).toMatch(new RegExp(`/auth/forgot-password/${data.id}$`));
  });

  it("gives two resets different ids", async () => {
    await call();
    await call();

    const ids = vi.mocked(prisma.resetPasswordRequest.create).mock.calls.map(([args]) => args.data.id);
    expect(ids[0]).not.toEqual(ids[1]);
  });
});
