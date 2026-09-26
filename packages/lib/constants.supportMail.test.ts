import { afterEach, describe, expect, it, vi } from "vitest";

const loadConstants = async () => {
  vi.resetModules();
  return import("./constants");
};

// Flowko: the account menu's Help item, the error page's "Contact Support", the account e-mails and the
// admin OAuth-client notification all mail SUPPORT_MAIL_ADDRESS. Without the build arg it fell back to
// Cal.com's help@cal.com.
describe("SUPPORT_MAIL_ADDRESS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back to Flowko's support address when the build arg is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS", undefined);

    const { SUPPORT_MAIL_ADDRESS } = await loadConstants();

    expect(SUPPORT_MAIL_ADDRESS).toBe("info@flowko.io");
  });

  it("falls back to Flowko's support address when the build arg is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS", "");

    const { SUPPORT_MAIL_ADDRESS } = await loadConstants();

    expect(SUPPORT_MAIL_ADDRESS).toBe("info@flowko.io");
  });

  it("uses the build arg when it is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS", "support@example.com");

    const { SUPPORT_MAIL_ADDRESS } = await loadConstants();

    expect(SUPPORT_MAIL_ADDRESS).toBe("support@example.com");
  });
});
