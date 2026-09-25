import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko (WH-2): every delivery re-checks the subscriber URL right before fetch, so a webhook stored
// before the guard, a scheduled trigger or a no-show task cannot reach loopback, the private network
// or the metadata service. booking.flowko.si is self-hosted (IS_SELF_HOSTED is true).
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  IS_SELF_HOSTED: true,
}));

import { WebhookVersion } from "./interface/IWebhookRepository";
import sendPayload, { sendGenericWebhookPayload } from "./sendPayload";

const data = {
  title: "Test Booking",
  startTime: "2024-01-01T10:00:00Z",
  endTime: "2024-01-01T11:00:00Z",
  organizer: { email: "organizer@example.com", name: "Organizer", timeZone: "UTC", language: { locale: "en" } },
  attendees: [],
  type: "test-event",
  description: "",
} as unknown as Parameters<typeof sendPayload>[4];

const webhookFor = (subscriberUrl: string) => ({
  subscriberUrl,
  appId: null,
  payloadTemplate: null,
  version: WebhookVersion.V_2021_10_20,
});

describe("Flowko: sendPayload re-checks the subscriber URL before delivery", () => {
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
    vi.unstubAllEnvs();
    mockFetch.mockReset();
  });

  it.each([
    "http://127.0.0.1:3000/api/auth/setup",
    "http://localhost:3000/",
    "http://10.0.0.1/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "https://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/",
    "https://metadata.attacker.example/latest/meta-data/",
  ])("refuses %s without fetching", async (url) => {
    await expect(
      sendPayload("secret", "BOOKING_CREATED", new Date().toISOString(), webhookFor(url), data)
    ).rejects.toThrow("Webhook URL is not allowed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("the refusal does not name the URL (U7b keeps webhook URLs out of logs)", async () => {
    await expect(
      sendPayload("secret", "BOOKING_CREATED", "", webhookFor("https://metadata.attacker.example/x"), data)
    ).rejects.toThrow(/^Webhook URL is not allowed: Hostname resolves to private IP$/);
  });

  it("refuses the generic (no-show task) payload as well", async () => {
    await expect(
      sendGenericWebhookPayload({
        secretKey: null,
        triggerEvent: "AFTER_HOSTS_CAL_VIDEO_NO_SHOW",
        createdAt: new Date().toISOString(),
        webhook: webhookFor("http://10.0.0.1/hook"),
        data: {},
      })
    ).rejects.toThrow("Webhook URL is not allowed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("delivers to a public https URL without following redirects and without a timeout by default", async () => {
    const result = await sendPayload("secret", "BOOKING_CREATED", "", webhookFor("https://hooks.example.com/cal"), data);
    expect(result).toEqual({ ok: true, status: 200 });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/cal");
    expect(options.redirect).toBe("manual");
    expect(options.signal).toBeUndefined();
  });

  it("delivers a stored public http URL (https-only is enforced when the URL is saved)", async () => {
    await sendPayload("secret", "BOOKING_CREATED", "", webhookFor("http://hooks.example.com/cal"), data);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("passes an abort signal when a timeout is requested", async () => {
    await sendPayload("secret", "PING", "", webhookFor("https://hooks.example.com/cal"), data, { timeoutMs: 10_000 });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS=true restores the upstream self-hosted behaviour", async () => {
    vi.stubEnv("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS", "true");
    await sendPayload("secret", "BOOKING_CREATED", "", webhookFor("http://10.0.0.1/hook"), data);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
