import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";

// Flowko: the web-push VAPID subject (the address push services use to reach the sender) was
// "mailto:support@cal.com". It is now mailto:SUPPORT_MAIL_ADDRESS (U12); a getter lets the test set it.
const mocks = vi.hoisted(() => ({
  supportMailAddress: undefined as string | undefined,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@calcom/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/constants")>();
  return {
    ...actual,
    get SUPPORT_MAIL_ADDRESS(): string {
      return mocks.supportMailAddress ?? actual.SUPPORT_MAIL_ADDRESS;
    },
  };
});

vi.mock("@nestjs/common", () => ({
  Logger: class {
    log = mocks.log;
    warn = mocks.warn;
    error = mocks.error;
  },
}));

const vapidKeys = webpush.generateVAPIDKeys();
const subscription = {
  endpoint: "https://push.example.com/send/abc",
  keys: { auth: "auth", p256dh: "p256dh" },
};

// The module configures web push on import, so each test imports a fresh copy with the VAPID keys set.
const loadWithVapidKeys = async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapidKeys.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", vapidKeys.privateKey);
  return import("./sendNotification");
};

// The `sub` claim of the VAPID JWT web-push would send with the next push (real web-push, no network).
const subjectOfNextPush = () => {
  const { headers } = webpush.generateRequestDetails(subscription);
  const jwt = /t=([^,\s]+)/.exec(String(headers.Authorization))?.[1] ?? "";
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).sub as string;
};

describe("sendNotification VAPID subject", () => {
  beforeEach(() => {
    vi.spyOn(webpush, "setVapidDetails");
    vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    mocks.supportMailAddress = undefined;
    mocks.log.mockClear();
    mocks.warn.mockClear();
    mocks.error.mockClear();
    // web-push clears its module-level VAPID details only for a single null argument
    (webpush.setVapidDetails as unknown as (details: null) => void)(null);
  });

  it("gives push services mailto:SUPPORT_MAIL_ADDRESS, which web-push accepts", async () => {
    mocks.supportMailAddress = "support@example.com";
    const { sendNotification } = await loadWithVapidKeys();

    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      "mailto:support@example.com",
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
    // web-push validated the subject (an https: or mailto: URL) instead of throwing
    expect(vi.mocked(webpush.setVapidDetails).mock.results[0].type).toBe("return");
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("VAPID keys loaded. Web push enabled.");

    const subject = subjectOfNextPush();
    expect(subject).toBe("mailto:support@example.com");
    const url = new URL(subject);
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("support@example.com");

    await sendNotification({ subscription, title: "Nova rezervacija", body: "Termin" });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("uses the constant's own value, not a Cal.com address", async () => {
    const { SUPPORT_MAIL_ADDRESS } = await import("@calcom/lib/constants");
    await loadWithVapidKeys();

    expect(subjectOfNextPush()).toBe(`mailto:${SUPPORT_MAIL_ADDRESS}`);
    expect(subjectOfNextPush()).not.toMatch(/@cal\.(com|diy)$/);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
