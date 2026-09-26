import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

// Flowko: the OpenAPI contact in calendso.yaml was support@cal.com. YAML cannot import SUPPORT_MAIL_ADDRESS,
// so the file repeats the constant's fallback (U12); this keeps the two in step.
const contactEmail = () => {
  const spec = yaml.load(readFileSync(path.join(__dirname, "calendso.yaml"), "utf8")) as {
    info?: { contact?: { email?: unknown } };
  };
  return spec.info?.contact?.email;
};

describe("calendso.yaml", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("lists SUPPORT_MAIL_ADDRESS's fallback as the API contact", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_MAIL_ADDRESS", undefined);
    vi.resetModules();
    const { SUPPORT_MAIL_ADDRESS } = await import("@calcom/lib/constants");

    expect(contactEmail()).toBe(SUPPORT_MAIL_ADDRESS);
    expect(contactEmail()).toBe("info@flowko.io");
  });
});
