import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@calcom/prisma";

// Flowko (WH-2): MEETING_STARTED/ENDED jobs (cron /api/cron/webhookTriggers) do their own fetch, so they
// re-check the subscriber URL right before it. booking.flowko.si is self-hosted (IS_SELF_HOSTED is true).
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  IS_SELF_HOSTED: true,
}));

import logger from "@calcom/lib/logger";

import { handleWebhookScheduledTriggers } from "./handleWebhookScheduledTriggers";

const job = (id: number, subscriberUrl: string) => ({
  id,
  jobName: null,
  subscriberUrl,
  payload: JSON.stringify({ triggerEvent: "MEETING_STARTED" }),
  webhook: { secret: "s", version: "2021-10-20" },
});

const prismaWithJobs = (jobs: ReturnType<typeof job>[]) => ({
  webhookScheduledTriggers: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue(jobs),
    delete: vi.fn().mockResolvedValue({}),
  },
  webhook: { findUniqueOrThrow: vi.fn() },
});

describe("Flowko: handleWebhookScheduledTriggers re-checks the subscriber URL", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    lookupMock.mockReset();
    lookupMock.mockImplementation(async (hostname: string) =>
      hostname === "metadata.attacker.example"
        ? [{ address: "169.254.169.254", family: 4 }]
        : [{ address: "93.184.215.14", family: 4 }]
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  it.each([
    "http://127.0.0.1:3000/api/auth/setup",
    "http://localhost:3000/",
    "http://10.0.0.1/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "https://metadata.attacker.example/latest/meta-data/",
  ])("skips %s but still deletes the job", async (url) => {
    const prisma = prismaWithJobs([job(7, url)]);
    await handleWebhookScheduledTriggers(prisma as unknown as PrismaClient);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(prisma.webhookScheduledTriggers.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it("logs the refusal without naming the URL (U7b)", async () => {
    const warn = vi.spyOn(logger, "warn");
    const prisma = prismaWithJobs([job(7, "https://metadata.attacker.example/latest/meta-data/")]);
    await handleWebhookScheduledTriggers(prisma as unknown as PrismaClient);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("Webhook URL is not allowed");
    expect(logged).not.toContain("metadata.attacker.example");
  });

  it("a refused job does not stop the public ones after it", async () => {
    const prisma = prismaWithJobs([job(7, "http://10.0.0.1/"), job(8, "https://hooks.example.com/cal")]);
    await handleWebhookScheduledTriggers(prisma as unknown as PrismaClient);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://hooks.example.com/cal");
    expect(prisma.webhookScheduledTriggers.delete).toHaveBeenCalledTimes(2);
  });

  it("delivers to a public https subscriber without following redirects", async () => {
    const prisma = prismaWithJobs([job(7, "https://hooks.example.com/cal")]);
    await handleWebhookScheduledTriggers(prisma as unknown as PrismaClient);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
    expect(prisma.webhookScheduledTriggers.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it("delivers a stored public http URL (https-only is enforced when the URL is saved)", async () => {
    const prisma = prismaWithJobs([job(7, "http://hooks.example.com/cal")]);
    await handleWebhookScheduledTriggers(prisma as unknown as PrismaClient);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
