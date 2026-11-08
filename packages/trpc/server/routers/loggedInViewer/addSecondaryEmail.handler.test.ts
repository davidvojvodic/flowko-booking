// Flowko U27 (E4): a secondary e-mail on the desk placeholder domain is refused before any lookup or write.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  secondaryFindUnique: vi.fn(),
  create: vi.fn(),
  sendEmailVerification: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    secondaryEmail: { findUnique: mocks.secondaryFindUnique, create: mocks.create },
  },
}));
vi.mock("@calcom/features/auth/lib/verifyEmail", () => ({ sendEmailVerification: mocks.sendEmailVerification }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: mocks.checkRateLimit }));

import { addSecondaryEmailHandler } from "./addSecondaryEmail.handler";

const ctx = { user: { id: 7, username: "ana", locale: "sl" } } as never;

describe("addSecondaryEmail and the desk placeholder domain (Flowko U27 E4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(null);
    mocks.secondaryFindUnique.mockResolvedValue(null);
    mocks.create.mockImplementation(({ data }: { data: { email: string } }) =>
      Promise.resolve({ id: 4, ...data })
    );
  });

  it.each(["x@flowko.invalid", "Desk-1@FLOWKO.INVALID"])("refuses %s and writes nothing", async (email) => {
    await expect(addSecondaryEmailHandler({ ctx, input: { email } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "invalid_email_address",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sendEmailVerification).not.toHaveBeenCalled();
  });

  it("adds an ordinary address as before", async () => {
    await expect(addSecondaryEmailHandler({ ctx, input: { email: "ana2@example.com" } })).resolves.toMatchObject({
      data: { id: 4, email: "ana2@example.com" },
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailVerification).toHaveBeenCalledTimes(1);
  });
});
