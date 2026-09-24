import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (WH-2): the webhook create, edit and test-trigger handlers use the DNS-resolving SSRF check,
// on a self-hosted build (booking.flowko.si) without FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS.
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  sendPayload: vi.fn(),
  updateTriggerForExistingBookings: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  IS_SELF_HOSTED: true,
}));
vi.mock("@calcom/features/webhooks/lib/sendPayload", () => ({ default: mocks.sendPayload }));
vi.mock("@calcom/features/webhooks/lib/scheduleTrigger", () => ({
  updateTriggerForExistingBookings: mocks.updateTriggerForExistingBookings,
  deleteWebhookScheduledTriggers: vi.fn(),
  cancelNoShowTasksForBooking: vi.fn(),
}));
vi.mock("@calcom/i18n/server", () => ({ getTranslation: vi.fn(async () => (key: string) => key) }));

import { createHandler } from "./create.handler";
import { editHandler } from "./edit.handler";
import { testTriggerHandler } from "./testTrigger.handler";

const admin = { id: 9, role: "ADMIN" } as unknown as Parameters<typeof createHandler>[0]["ctx"]["user"];

// A public-looking hostname whose A record points at the cloud-metadata service
const REBOUND_URL = "https://hooks.attacker.example/cal";
const PUBLIC_URL = "https://hooks.example.com/cal";

function resolveTo(address: string) {
  mocks.lookup.mockImplementation(async (hostname: string) =>
    hostname === "hooks.attacker.example"
      ? [{ address, family: address.includes(":") ? 6 : 4 }]
      : [{ address: "93.184.215.14", family: 4 }]
  );
}

describe("Flowko: webhook handlers refuse private and metadata targets", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.lookup.mockReset();
    mocks.sendPayload.mockReset();
    mocks.updateTriggerForExistingBookings.mockReset();
    resolveTo("169.254.169.254");
  });

  describe("create", () => {
    const input = { eventTriggers: [], active: true, payloadTemplate: null } as unknown as Parameters<
      typeof createHandler
    >[0]["input"];

    it.each([REBOUND_URL, "http://127.0.0.1:3000/", "http://10.0.0.1/", "http://[::ffff:a9fe:a9fe]/"])(
      "refuses %s",
      async (subscriberUrl) => {
        await expect(createHandler({ ctx: { user: admin }, input: { ...input, subscriberUrl } })).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
        expect(prismaMock.webhook.create).not.toHaveBeenCalled();
      }
    );

    it("creates a webhook with a public https URL", async () => {
      prismaMock.webhook.create.mockResolvedValue({ id: "wh-1", eventTriggers: [] } as never);
      await createHandler({ ctx: { user: admin }, input: { ...input, subscriberUrl: PUBLIC_URL } });
      expect(prismaMock.webhook.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("edit", () => {
    const input = { id: "wh-1", payloadTemplate: null } as unknown as Parameters<typeof editHandler>[0]["input"];

    beforeEach(() => {
      prismaMock.webhook.findUnique.mockResolvedValue({
        id: "wh-1",
        subscriberUrl: PUBLIC_URL,
        active: true,
        eventTriggers: [],
        platform: false,
      } as never);
      prismaMock.webhook.update.mockResolvedValue({ id: "wh-1", eventTriggers: [] } as never);
    });

    it("refuses a new URL whose hostname resolves to a private address", async () => {
      resolveTo("10.0.0.5");
      await expect(
        editHandler({ ctx: { user: admin }, input: { ...input, subscriberUrl: REBOUND_URL } })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prismaMock.webhook.update).not.toHaveBeenCalled();
    });

    it("saves a new public https URL", async () => {
      await editHandler({ ctx: { user: admin }, input: { ...input, subscriberUrl: "https://other.example.com/x" } });
      expect(prismaMock.webhook.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("testTrigger", () => {
    it.each([REBOUND_URL, "http://localhost:3000/api/auth/setup", "https://[::ffff:a9fe:a9fe]/"])(
      "refuses %s without sending anything",
      async (url) => {
        const result = await testTriggerHandler({ ctx: {}, input: { url, type: "PING" } });
        expect(result).toMatchObject({ ok: false, status: 400 });
        expect(mocks.sendPayload).not.toHaveBeenCalled();
      }
    );

    it("sends to a public https URL", async () => {
      mocks.sendPayload.mockResolvedValue({ ok: true, status: 200 });
      const result = await testTriggerHandler({ ctx: {}, input: { url: PUBLIC_URL, type: "PING" } });
      expect(result).toEqual({ ok: true, status: 200 });
      expect(mocks.sendPayload).toHaveBeenCalledTimes(1);
    });

    it("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS=true restores the upstream self-hosted behaviour", async () => {
      vi.stubEnv("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS", "true");
      mocks.sendPayload.mockResolvedValue({ ok: true, status: 200 });
      const result = await testTriggerHandler({ ctx: {}, input: { url: "http://10.0.0.1/", type: "PING" } });
      expect(result).toEqual({ ok: true, status: 200 });
      vi.unstubAllEnvs();
    });
  });
});
