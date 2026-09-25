import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { BookingStatus } from "@calcom/prisma/enums";

import { noShowHandler } from "./markHostAsNoShow.handler";

const { handleMarkHostNoShow } = vi.hoisted(() => ({ handleMarkHostNoShow: vi.fn() }));

vi.mock("@calcom/features/handleMarkNoShow", () => ({ handleMarkHostNoShow }));

// The real limiter, wrapped so the tests can see what it is called with
vi.mock("@calcom/lib/checkRateLimitAndThrowError", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/checkRateLimitAndThrowError")>();
  return { checkRateLimitAndThrowError: vi.fn(actual.checkRateLimitAndThrowError) };
});

const HOUR = 60 * 60 * 1000;

function ctxFrom(ip: string) {
  return { req: { headers: { "x-forwarded-for": ip } } } as unknown as Parameters<
    typeof noShowHandler
  >[0]["ctx"];
}

function bookingRow(overrides: { status?: BookingStatus; startTime?: Date } = {}) {
  return {
    status: overrides.status ?? BookingStatus.ACCEPTED,
    startTime: overrides.startTime ?? new Date(Date.now() - HOUR),
  } as never;
}

function resetSharedLimiter() {
  delete (globalThis as { flowkoInMemoryRateLimiter?: unknown }).flowkoInMemoryRateLimiter;
}

describe("publicViewer.markHostAsNoShow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedLimiter();
    handleMarkHostNoShow.mockResolvedValue({ attendees: [], noShowHost: true, message: "ok" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSharedLimiter();
  });

  it("marks the host as a no-show on an accepted booking that has started", async () => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow());

    await expect(
      noShowHandler({ ctx: ctxFrom("203.0.113.1"), input: { bookingUid: "uid-1", noShowHost: true } })
    ).resolves.toEqual({ attendees: [], noShowHost: true, message: "ok" });

    expect(prismaMock.booking.findUnique).toHaveBeenCalledWith({
      where: { uid: "uid-1" },
      select: { status: true, startTime: true },
    });
    expect(handleMarkHostNoShow).toHaveBeenCalledWith({ bookingUid: "uid-1", noShowHost: true });
  });

  // The booker page only ever reports the host; clearing the flag would undo a real attendee's report
  it("refuses to clear the flag", async () => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow());

    await expect(
      noShowHandler({ ctx: ctxFrom("203.0.113.1"), input: { bookingUid: "uid-1", noShowHost: false } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(handleMarkHostNoShow).not.toHaveBeenCalled();
  });

  it("refuses a booking that has not started yet", async () => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow({ startTime: new Date(Date.now() + HOUR) }));

    await expect(
      noShowHandler({ ctx: ctxFrom("203.0.113.1"), input: { bookingUid: "uid-1", noShowHost: true } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(handleMarkHostNoShow).not.toHaveBeenCalled();
  });

  it.each([BookingStatus.PENDING, BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.AWAITING_HOST])(
    "refuses a %s booking",
    async (status) => {
      prismaMock.booking.findUnique.mockResolvedValue(bookingRow({ status }));

      await expect(
        noShowHandler({ ctx: ctxFrom("203.0.113.1"), input: { bookingUid: "uid-1", noShowHost: true } })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(handleMarkHostNoShow).not.toHaveBeenCalled();
    }
  );

  // Otherwise the answer tells a caller which guessed uids exist
  it("answers a missing uid exactly like a booking it refuses", async () => {
    const call = () =>
      noShowHandler({ ctx: ctxFrom("203.0.113.1"), input: { bookingUid: "uid-1", noShowHost: true } }).catch(
        (error: { code: string; message: string }) => ({ code: error.code, message: error.message })
      );

    prismaMock.booking.findUnique.mockResolvedValue(null);
    const missing = await call();
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow({ startTime: new Date(Date.now() + HOUR) }));
    const notStarted = await call();
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow({ status: BookingStatus.CANCELLED }));
    const notAccepted = await call();

    expect(missing).toEqual({ code: "BAD_REQUEST", message: "Failed to update no-show status" });
    expect(notStarted).toEqual(missing);
    expect(notAccepted).toEqual(missing);
    expect(handleMarkHostNoShow).not.toHaveBeenCalled();
  });

  it("counts every call against the caller's hashed IP, a refused one included", async () => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow());

    await noShowHandler({ ctx: ctxFrom("203.0.113.7"), input: { bookingUid: "uid-1", noShowHost: true } });
    await expect(
      noShowHandler({ ctx: ctxFrom("203.0.113.7"), input: { bookingUid: "uid-1", noShowHost: false } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(checkRateLimitAndThrowError).toHaveBeenCalledTimes(2);
    expect(checkRateLimitAndThrowError).toHaveBeenNthCalledWith(1, {
      rateLimitingType: "core",
      identifier: `markHostAsNoShow:${piiHasher.hash("203.0.113.7")}`,
    });
    expect(checkRateLimitAndThrowError).toHaveBeenNthCalledWith(2, {
      rateLimitingType: "core",
      identifier: `markHostAsNoShow:${piiHasher.hash("203.0.113.7")}`,
    });
  });

  // UNKEY_ROOT_KEY is unset on booking.flowko.si, so this is the in-process limiter it runs with
  it("stops a caller after 10 calls a minute, before it looks the booking up", async () => {
    vi.stubEnv("UNKEY_ROOT_KEY", "");
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_IS_E2E", "");
    prismaMock.booking.findUnique.mockResolvedValue(null);

    const guess = (ip: string, i: number) =>
      noShowHandler({ ctx: ctxFrom(ip), input: { bookingUid: `guess-${i}`, noShowHost: true } });

    for (let i = 0; i < 10; i++) {
      await expect(guess("203.0.113.9", i)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(guess("203.0.113.9", 10)).rejects.toMatchObject({ statusCode: 429 });
    expect(prismaMock.booking.findUnique).toHaveBeenCalledTimes(10);

    // Another IP has its own window
    await expect(guess("198.51.100.4", 11)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
