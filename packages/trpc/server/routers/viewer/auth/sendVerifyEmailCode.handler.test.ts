import { sendEmailVerificationByCode } from "@calcom/features/auth/lib/verifyEmail";
import { HttpError } from "@calcom/lib/http-error";
import { createInMemoryRateLimiter } from "@calcom/lib/rateLimit";
import { prisma } from "@calcom/prisma";
import type { NextApiRequest } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkEmailVerificationRequired } from "../../publicViewer/checkIfUserEmailVerificationRequired.handler";
import { sendVerifyEmailCode, sendVerifyEmailCodeHandler } from "./sendVerifyEmailCode.handler";

// Flowko: the real checkRateLimitAndThrowError, getIP and PiiHasher, driven by a real in-memory limiter with a
// fake clock (rateLimiter() itself always passes under vitest). Each test gets a fresh one.
const rateLimitState = vi.hoisted(() => ({
  now: 1_800_000_000_000,
  limiter: undefined as undefined | ((helper: { identifier: string }) => Promise<unknown>),
}));

vi.mock("@calcom/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/rateLimit")>();
  return { ...actual, rateLimiter: () => rateLimitState.limiter };
});

vi.mock("@calcom/features/auth/lib/verifyEmail", () => ({
  sendEmailVerificationByCode: vi.fn(),
}));

vi.mock("@calcom/features/eventtypes/di/EventTypeService.container", () => ({
  getEventTypeService: () => ({ shouldHideBrandingForEventType: vi.fn().mockResolvedValue(false) }),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: { eventType: { findUnique: vi.fn() } },
}));

vi.mock("../../publicViewer/checkIfUserEmailVerificationRequired.handler", () => ({
  checkEmailVerificationRequired: vi.fn(),
}));

const mockSend = vi.mocked(sendEmailVerificationByCode);
const mockFindEventType = vi.mocked(prisma.eventType.findUnique);
const mockVerificationRequired = vi.mocked(checkEmailVerificationRequired);

const requestFrom = (ip: string) => ({ headers: { "x-forwarded-for": ip } }) as unknown as NextApiRequest;

let ipCounter = 0;
/** Each call comes from a fresh IP, so only the per-recipient limit can refuse it. */
const sendFromFreshIp = async (email: string, eventTypeId: number | undefined = 1) => {
  ipCounter++;
  try {
    return await sendVerifyEmailCodeHandler({
      input: { email, language: "en", eventTypeId },
      req: requestFrom(`198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`),
    });
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 429) return "limited" as const;
    throw error;
  }
};

describe("sendVerifyEmailCode rate limits", () => {
  beforeEach(() => {
    rateLimitState.now = 1_800_000_000_000;
    rateLimitState.limiter = createInMemoryRateLimiter({ now: () => rateLimitState.now });
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true, skipped: false });
    mockFindEventType.mockReset();
    mockFindEventType.mockResolvedValue({ requiresBookerEmailVerification: true } as never);
    mockVerificationRequired.mockReset();
    mockVerificationRequired.mockResolvedValue(false);
  });

  it("sends one mailbox at most 5 codes per 10 minutes, whatever the caller's IP", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await sendFromFreshIp("guest@example.com")).toEqual({ ok: true, skipped: false });
    }

    expect(await sendFromFreshIp("guest@example.com")).toBe("limited");
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("frees the mailbox again after 10 minutes", async () => {
    for (let i = 0; i < 5; i++) await sendFromFreshIp("guest@example.com");
    expect(await sendFromFreshIp("guest@example.com")).toBe("limited");

    rateLimitState.now += 9 * 60_000;
    expect(await sendFromFreshIp("guest@example.com")).toBe("limited");

    rateLimitState.now += 60_000;
    expect(await sendFromFreshIp("guest@example.com")).toEqual({ ok: true, skipped: false });
  });

  it("counts case, +tag and Gmail dot variants of one mailbox together", async () => {
    await sendFromFreshIp("guest@gmail.com");
    await sendFromFreshIp("Guest@Gmail.com");
    await sendFromFreshIp("guest+1@gmail.com");
    await sendFromFreshIp("g.u.e.s.t@gmail.com");
    await sendFromFreshIp("guest@googlemail.com");

    expect(await sendFromFreshIp("GUEST+x@gmail.com")).toBe("limited");
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("keeps separate allowances for different mailboxes", async () => {
    for (let i = 0; i < 5; i++) await sendFromFreshIp("guest@example.com");
    expect(await sendFromFreshIp("guest@example.com")).toBe("limited");

    expect(await sendFromFreshIp("other@example.com")).toEqual({ ok: true, skipped: false });
    // Dots are only folded for Gmail; elsewhere they can be different mailboxes.
    expect(await sendFromFreshIp("gu.est@example.com")).toEqual({ ok: true, skipped: false });
  });

  it("does not count requests that send nothing", async () => {
    mockFindEventType.mockResolvedValue({ requiresBookerEmailVerification: false } as never);
    for (let i = 0; i < 10; i++) {
      expect(await sendFromFreshIp("guest@example.com")).toEqual({ ok: true, skipped: true });
    }

    mockFindEventType.mockResolvedValue({ requiresBookerEmailVerification: true } as never);
    for (let i = 0; i < 5; i++) {
      expect(await sendFromFreshIp("guest@example.com")).toEqual({ ok: true, skipped: false });
    }
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("also caps the mailbox when a user's own setting requires the code", async () => {
    mockVerificationRequired.mockResolvedValue(true);
    for (let i = 0; i < 5; i++) await sendFromFreshIp("tenant@example.com", undefined);

    expect(await sendFromFreshIp("tenant@example.com", undefined)).toBe("limited");
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it("applies the same cap when called without a request", async () => {
    for (let i = 0; i < 5; i++) {
      await sendVerifyEmailCode({
        input: { email: "guest@example.com", language: "en", eventTypeId: 1 },
        identifier: `caller-${i}`,
      });
    }

    await expect(
      sendVerifyEmailCode({
        input: { email: "guest@example.com", language: "en", eventTypeId: 1 },
        identifier: "caller-5",
      })
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("still limits one IP to 10 requests a minute across mailboxes", async () => {
    const req = requestFrom("198.51.100.1");
    for (let i = 0; i < 10; i++) {
      await sendVerifyEmailCodeHandler({ input: { email: `guest${i}@example.com`, language: "en", eventTypeId: 1 }, req });
    }

    await expect(
      sendVerifyEmailCodeHandler({ input: { email: "guest10@example.com", language: "en", eventTypeId: 1 }, req })
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(mockSend).toHaveBeenCalledTimes(10);
  });
});
