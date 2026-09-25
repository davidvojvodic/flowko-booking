import { afterEach, describe, expect, it, vi } from "vitest";

const loadConstants = async () => {
  vi.resetModules();
  return import("./constants");
};

// Flowko: the Google Calendar connect notice, the booking form and signup link these URLs. Without the
// NEXT_PUBLIC_ build args they fell back to Cal.com's privacy policy and terms.
describe("website policy URLs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fall back to Flowko's privacy policy and terms when the build args are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_WEBSITE_TERMS_URL", undefined);

    const { WEBSITE_PRIVACY_POLICY_URL, WEBSITE_TERMS_URL } = await loadConstants();

    expect(WEBSITE_PRIVACY_POLICY_URL).toBe("https://flowko.si/privacy");
    expect(WEBSITE_TERMS_URL).toBe("https://flowko.si/terms");
  });

  it("fall back to Flowko's URLs when the build args are empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WEBSITE_TERMS_URL", "");

    const { WEBSITE_PRIVACY_POLICY_URL, WEBSITE_TERMS_URL } = await loadConstants();

    expect(WEBSITE_PRIVACY_POLICY_URL).toBe("https://flowko.si/privacy");
    expect(WEBSITE_TERMS_URL).toBe("https://flowko.si/terms");
  });

  it("use the build args when they are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEBSITE_PRIVACY_POLICY_URL", "https://example.test/privacy");
    vi.stubEnv("NEXT_PUBLIC_WEBSITE_TERMS_URL", "https://example.test/terms");

    const { WEBSITE_PRIVACY_POLICY_URL, WEBSITE_TERMS_URL } = await loadConstants();

    expect(WEBSITE_PRIVACY_POLICY_URL).toBe("https://example.test/privacy");
    expect(WEBSITE_TERMS_URL).toBe("https://example.test/terms");
  });
});
