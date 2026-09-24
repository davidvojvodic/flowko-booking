import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Flowko: booking.flowko.si is not a cal.com domain, so IS_SELF_HOSTED is true there. Without the
// operator opt-in FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS=true the SaaS checks must still run.
vi.mock("@calcom/lib/constants", () => ({
  IS_SELF_HOSTED: true,
  IS_PRODUCTION: true,
}));

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
}));

import { validateUrlForSSRF, validateUrlForSSRFSync } from "./ssrfProtection";

const PUBLIC_ADDRESS = [{ address: "93.184.215.14", family: 4 }];

describe("Flowko: self-hosted SSRF guard without FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue(PUBLIC_ADDRESS);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["http://127.0.0.1/", "Only HTTPS URLs are allowed"],
    ["http://10.0.0.1/", "Only HTTPS URLs are allowed"],
    ["http://[::ffff:a9fe:a9fe]/", "Only HTTPS URLs are allowed"],
    ["http://localhost:3000/api/auth/setup", "Only HTTPS URLs are allowed"],
    ["http://postgres.railway.internal:5432/", "Only HTTPS URLs are allowed"],
    ["https://127.0.0.1/", "Blocked hostname"],
    ["https://localhost:3000/", "Blocked hostname"],
    ["https://[::1]/", "Blocked hostname"],
    ["https://10.0.0.1/", "Private IP address"],
    ["https://192.168.1.1/", "Private IP address"],
    ["https://[::ffff:a9fe:a9fe]/latest/meta-data/", "Private IP address"],
    ["https://[::ffff:127.0.0.1]/", "Private IP address"],
    ["https://[fd12::1]/", "Private IP address"],
    ["https://169.254.169.254/", "Blocked hostname"],
  ])("refuses %s (sync and async)", async (url, error) => {
    expect(validateUrlForSSRFSync(url)).toEqual({ isValid: false, error });
    expect(await validateUrlForSSRF(url)).toEqual({ isValid: false, error });
  });

  it("refuses a hostname that resolves to the cloud-metadata address", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const result = await validateUrlForSSRF("https://metadata.attacker.example/latest/meta-data/");
    expect(result).toEqual({ isValid: false, error: "Hostname resolves to private IP" });
    expect(lookupMock).toHaveBeenCalledWith("metadata.attacker.example", { all: true });
  });

  it("refuses a hostname when any resolved address is private", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.215.14", family: 4 },
      { address: "::ffff:10.0.0.5", family: 6 },
    ]);
    expect((await validateUrlForSSRF("https://mixed.attacker.example/")).isValid).toBe(false);
  });

  it("allows a public https URL", async () => {
    expect(validateUrlForSSRFSync("https://hooks.example.com/cal")).toEqual({ isValid: true });
    expect(await validateUrlForSSRF("https://hooks.example.com/cal")).toEqual({ isValid: true });
  });

  it("only the exact value 'true' opens the private network", async () => {
    vi.stubEnv("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS", "1");
    expect(validateUrlForSSRFSync("http://10.0.0.1/").isValid).toBe(false);
    vi.stubEnv("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS", "false");
    expect(validateUrlForSSRFSync("http://10.0.0.1/").isValid).toBe(false);
  });
});

describe("Flowko: FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS=true restores upstream self-hosted behaviour", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
    vi.stubEnv("FLOWKO_ALLOW_PRIVATE_WEBHOOK_URLS", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows http, loopback and private addresses", async () => {
    for (const url of ["http://127.0.0.1/", "http://10.0.0.1/", "http://localhost:3000/", "http://n8n.railway.internal/"]) {
      expect(validateUrlForSSRFSync(url)).toEqual({ isValid: true });
      expect(await validateUrlForSSRF(url)).toEqual({ isValid: true });
    }
  });

  it("still blocks the literal cloud-metadata hostnames and non-http protocols", async () => {
    expect(validateUrlForSSRFSync("http://169.254.169.254/").isValid).toBe(false);
    expect(validateUrlForSSRFSync("http://metadata.google.internal/").isValid).toBe(false);
    expect(validateUrlForSSRFSync("file:///etc/passwd").isValid).toBe(false);
  });
});
