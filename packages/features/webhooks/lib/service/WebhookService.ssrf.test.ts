import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebhookTriggerEvents } from "@calcom/prisma/enums";

// Flowko (WH-2): BOOKING_REQUESTED (an anonymous booking of an event type that requires confirmation ->
// the sync tasker -> WebhookTaskConsumer) and OOO webhooks are delivered by
// WebhookService.sendWebhookDirectly, not by sendPayload. It must re-check the subscriber URL, with DNS,
// right before fetch. booking.flowko.si is self-hosted (IS_SELF_HOSTED is true).
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  IS_SELF_HOSTED: true,
}));

import type { WebhookSubscriber } from "../dto/types";
import type { WebhookPayload } from "../factory/types";
import type { ILogger, ITasker } from "../interface/infrastructure";
import { WebhookVersion } from "../interface/IWebhookRepository";
import type { IWebhookRepository } from "../interface/services";
import { WebhookService } from "./WebhookService";

const subLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const logger = { getSubLogger: () => subLogger } as unknown as ILogger;

const subscriberFor = (subscriberUrl: string): WebhookSubscriber => ({
  id: "webhook-1",
  subscriberUrl,
  payloadTemplate: null,
  appId: null,
  secret: "test-secret",
  eventTriggers: [WebhookTriggerEvents.BOOKING_REQUESTED],
  version: WebhookVersion.V_2021_10_20,
});

const payload = {
  createdAt: new Date().toISOString(),
  payload: { triggerEvent: WebhookTriggerEvents.BOOKING_REQUESTED },
} as unknown as WebhookPayload;

describe("Flowko: WebhookService re-checks the subscriber URL before direct delivery", () => {
  const mockFetch = vi.fn();
  const service = new WebhookService({} as IWebhookRepository, {} as ITasker, logger);

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("internal service secret reply"),
    });
    delete process.env.TASKER_ENABLE_WEBHOOKS;
    lookupMock.mockReset();
    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "metadata.attacker.example") return [{ address: "169.254.169.254", family: 4 }];
      if (hostname === "internal.attacker.example") return [{ address: "10.0.0.5", family: 4 }];
      if (hostname === "postgres.railway.internal") return [{ address: "fd12:3456:789a::3", family: 6 }];
      return [{ address: "93.184.215.14", family: 4 }];
    });
    for (const fn of Object.values(subLogger)) fn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it.each([
    "http://127.0.0.1:3000/api/auth/setup",
    "http://localhost:3000/",
    "http://10.0.0.1/",
    "http://postgres.railway.internal:5432/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "https://metadata.attacker.example/latest/meta-data/",
    "https://internal.attacker.example/hook",
  ])("refuses %s without fetching", async (url) => {
    await service.processWebhooks(WebhookTriggerEvents.BOOKING_REQUESTED, payload, [subscriberFor(url)]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(subLogger.error).toHaveBeenCalledWith(
      "Webhook failed",
      expect.objectContaining({ error: expect.stringMatching(/^Webhook URL is not allowed: /) })
    );
  });

  it("the refusal names no URL (U7b keeps webhook URLs out of logs)", async () => {
    await service.processWebhooks(WebhookTriggerEvents.BOOKING_REQUESTED, payload, [
      subscriberFor("https://metadata.attacker.example/latest/meta-data/"),
    ]);
    const logged = JSON.stringify([subLogger.warn.mock.calls, subLogger.error.mock.calls]);
    expect(logged).toContain("Webhook URL is not allowed: Hostname resolves to private IP");
    expect(logged).not.toContain("metadata.attacker.example");
  });

  it("still delivers to a public https subscriber without following redirects", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue("") });
    await service.processWebhooks(WebhookTriggerEvents.BOOKING_REQUESTED, payload, [
      subscriberFor("https://hooks.example.com/flowko"),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://hooks.example.com/flowko");
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual" });
  });

  it("delivers a stored public http URL (https-only is enforced when the URL is saved)", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue("") });
    await service.processWebhooks(WebhookTriggerEvents.BOOKING_REQUESTED, payload, [
      subscriberFor("http://hooks.example.com/flowko"),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not copy the subscriber's response body into the logs", async () => {
    await service.processWebhooks(WebhookTriggerEvents.BOOKING_REQUESTED, payload, [
      subscriberFor("https://hooks.example.com/flowko"),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(subLogger.error).toHaveBeenCalledWith(
      "Webhook failed",
      expect.objectContaining({ statusCode: 500 })
    );
    expect(JSON.stringify(subLogger.error.mock.calls)).not.toContain("internal service secret reply");
  });
});
