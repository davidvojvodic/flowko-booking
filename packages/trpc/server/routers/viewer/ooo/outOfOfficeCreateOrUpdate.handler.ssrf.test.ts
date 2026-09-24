import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (WH-2): OOO_CREATED webhooks go through sendPayload, which re-checks the subscriber URL (with DNS)
// before fetch and rejects a refused one. The handler does not await sendPayload, so the rejection must be
// caught and logged (without the URL) instead of becoming an unhandled rejection. booking.flowko.si is
// self-hosted (IS_SELF_HOSTED is true).
const { lookupMock, subLogger, getWebhooksMock } = vi.hoisted(() => {
  const subLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getSubLogger: vi.fn() };
  subLogger.getSubLogger.mockReturnValue(subLogger);
  return { lookupMock: vi.fn(), subLogger, getWebhooksMock: vi.fn() };
});
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  IS_SELF_HOSTED: true,
}));
vi.mock("@calcom/lib/logger", () => ({ default: subLogger }));
vi.mock("@calcom/features/webhooks/lib/getWebhooks", () => ({ default: getWebhooksMock }));

import { outOfOfficeCreateOrUpdate } from "./outOfOfficeCreateOrUpdate.handler";

const user = {
  id: 4,
  username: "salon",
  email: "salon@example.com",
  name: "Salon",
  timeZone: "UTC",
  organizationId: null,
  locale: "en",
} as unknown as Parameters<typeof outOfOfficeCreateOrUpdate>[0]["ctx"]["user"];

const input = {
  dateRange: {
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-02T00:00:00.000Z"),
  },
  startDateOffset: 0,
  endDateOffset: 0,
  reasonId: 1,
  notes: "",
  toTeamUserId: null,
};

const subscriberFor = (subscriberUrl: string) => ({
  id: "webhook-1",
  subscriberUrl,
  payloadTemplate: null,
  appId: null,
  secret: "s",
  version: "2021-10-20",
});

describe("Flowko: outOfOfficeCreateOrUpdate OOO_CREATED webhook delivery", () => {
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
    for (const fn of [subLogger.debug, subLogger.info, subLogger.warn, subLogger.error]) fn.mockClear();

    const entry = {
      id: 11,
      uuid: "ooo-1",
      start: new Date("2026-10-01T00:00:00.000Z"),
      end: new Date("2026-10-02T23:59:59.999Z"),
      createdAt: new Date("2026-09-24T10:00:00.000Z"),
      updatedAt: new Date("2026-09-24T10:00:00.000Z"),
      notes: "",
    };
    prismaMock.outOfOfficeEntry.findFirst.mockResolvedValue(null);
    prismaMock.outOfOfficeEntry.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(entry as never);
    prismaMock.outOfOfficeEntry.upsert.mockResolvedValue(entry as never);
    prismaMock.outOfOfficeReason.findUnique.mockResolvedValue({ reason: "vacation", emoji: "🏝️" } as never);
    prismaMock.membership.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
    getWebhooksMock.mockReset();
  });

  it.each([
    "http://127.0.0.1:3000/api/auth/setup",
    "http://10.0.0.1/",
    "https://metadata.attacker.example/latest/meta-data/",
  ])("does not deliver to %s and logs the refusal without its URL", async (url) => {
    getWebhooksMock.mockResolvedValue([subscriberFor(url)]);

    await expect(outOfOfficeCreateOrUpdate({ ctx: { user }, input })).resolves.toEqual({});

    await vi.waitFor(() =>
      expect(subLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("webhookId: webhook-1"),
        expect.stringContaining("Webhook URL is not allowed")
      )
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(subLogger.error.mock.calls)).not.toContain(new URL(url).hostname);
  });

  it("delivers to a public https subscriber", async () => {
    getWebhooksMock.mockResolvedValue([subscriberFor("https://hooks.example.com/ooo")]);

    await expect(outOfOfficeCreateOrUpdate({ ctx: { user }, input })).resolves.toEqual({});

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch.mock.calls[0][0]).toBe("https://hooks.example.com/ooo");
    expect(subLogger.error).not.toHaveBeenCalled();
  });
});
