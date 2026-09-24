import type { NextApiRequest } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import getIP, { isIpInBanlist, parseIpFromHeaders } from "./getIP";

function buildRequest(headers: Record<string, string>): Request {
  return new Request("https://example.com", { headers });
}

function buildNextApiRequest(headers: Record<string, string | string[]>): NextApiRequest {
  return { headers } as unknown as NextApiRequest;
}

describe("parseIpFromHeaders", () => {
  it("returns the first IP from a comma-separated string", () => {
    expect(parseIpFromHeaders("1.2.3.4, 5.6.7.8")).toBe("1.2.3.4");
  });

  it("returns the single IP when there is no comma", () => {
    expect(parseIpFromHeaders("1.2.3.4")).toBe("1.2.3.4");
  });

  it("returns the first element when given an array", () => {
    expect(parseIpFromHeaders(["1.2.3.4", "5.6.7.8"])).toBe("1.2.3.4");
  });

  it("trims leading/trailing whitespace from a padded string value", () => {
    expect(parseIpFromHeaders("  1.2.3.4  , 5.6.7.8")).toBe("1.2.3.4");
  });

  it("trims whitespace after splitting on comma", () => {
    expect(parseIpFromHeaders("1.2.3.4 , 5.6.7.8")).toBe("1.2.3.4");
  });

  it("trims leading/trailing whitespace from a padded array element", () => {
    expect(parseIpFromHeaders(["  1.2.3.4  ", "5.6.7.8"])).toBe("1.2.3.4");
  });
  it("returns an empty string for an empty array instead of throwing", () => {
    expect(parseIpFromHeaders([])).toBe("");
  });
  it("trims tabs and other whitespace, not just spaces", () => {
    expect(parseIpFromHeaders("\t1.2.3.4\t, 5.6.7.8")).toBe("1.2.3.4");
  });
});

describe("getIP", () => {
  // Flowko: Cloudflare headers are trusted only with TRUST_CLOUDFLARE_IP_HEADERS=true. Every test
  // starts from the deployed default (unset) so a stray env var cannot mask a regression.
  beforeEach(() => {
    vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("with Web Request", () => {
    describe("with TRUST_CLOUDFLARE_IP_HEADERS=true", () => {
      beforeEach(() => {
        vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", "true");
      });

      it("returns cf-connecting-ip when present", () => {
        const req = buildRequest({ "cf-connecting-ip": "1.1.1.1" });
        expect(getIP(req)).toBe("1.1.1.1");
      });

      it("prefers cf-connecting-ip over other headers", () => {
        const req = buildRequest({
          "cf-connecting-ip": "1.1.1.1",
          "true-client-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3",
          "x-real-ip": "4.4.4.4",
        });
        expect(getIP(req)).toBe("1.1.1.1");
      });

      it("falls back to true-client-ip when cf-connecting-ip is absent", () => {
        const req = buildRequest({
          "true-client-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3",
          "x-real-ip": "4.4.4.4",
        });
        expect(getIP(req)).toBe("2.2.2.2");
      });

      it("still falls back to x-forwarded-for when no Cloudflare header is sent", () => {
        const req = buildRequest({ "x-forwarded-for": "3.3.3.3, 10.0.0.1", "x-real-ip": "4.4.4.4" });
        expect(getIP(req)).toBe("3.3.3.3");
      });
    });

    describe("without TRUST_CLOUDFLARE_IP_HEADERS (Flowko default: no Cloudflare in front)", () => {
      it("ignores a spoofed cf-connecting-ip and uses x-forwarded-for", () => {
        const req = buildRequest({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "3.3.3.3" });
        expect(getIP(req)).toBe("3.3.3.3");
      });

      it("ignores a spoofed true-client-ip and uses x-forwarded-for", () => {
        const req = buildRequest({ "true-client-ip": "203.0.113.8", "x-forwarded-for": "3.3.3.3" });
        expect(getIP(req)).toBe("3.3.3.3");
      });

      it("ignores both Cloudflare headers when all four headers are sent", () => {
        const req = buildRequest({
          "cf-connecting-ip": "1.1.1.1",
          "true-client-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3",
          "x-real-ip": "4.4.4.4",
        });
        expect(getIP(req)).toBe("3.3.3.3");
      });

      it("falls back to x-real-ip, not a Cloudflare header, when x-forwarded-for is absent", () => {
        const req = buildRequest({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "4.4.4.4" });
        expect(getIP(req)).toBe("4.4.4.4");
      });

      it("returns 127.0.0.1 when only Cloudflare headers are sent", () => {
        const req = buildRequest({ "cf-connecting-ip": "1.1.1.1", "true-client-ip": "2.2.2.2" });
        expect(getIP(req)).toBe("127.0.0.1");
      });

      it("cannot mint a fresh identifier per request by rotating cf-connecting-ip", () => {
        const ips = ["203.0.113.1", "203.0.113.2", "203.0.113.3"].map((spoofed) =>
          getIP(buildRequest({ "cf-connecting-ip": spoofed, "x-forwarded-for": "198.51.100.7" }))
        );
        expect(new Set(ips)).toEqual(new Set(["198.51.100.7"]));
      });

      it.each(["1", "TRUE", "yes", "false", ""])(
        "treats TRUST_CLOUDFLARE_IP_HEADERS=%j as not set",
        (value) => {
          vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", value);
          const req = buildRequest({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "3.3.3.3" });
          expect(getIP(req)).toBe("3.3.3.3");
        }
      );
    });

    it("falls back to x-forwarded-for when cf and true-client headers are absent", () => {
      const req = buildRequest({
        "x-forwarded-for": "3.3.3.3, 10.0.0.1",
        "x-real-ip": "4.4.4.4",
      });
      expect(getIP(req)).toBe("3.3.3.3");
    });

    it("falls back to x-real-ip as last resort", () => {
      const req = buildRequest({ "x-real-ip": "4.4.4.4" });
      expect(getIP(req)).toBe("4.4.4.4");
    });

    it("returns 127.0.0.1 when no IP headers are present", () => {
      const req = buildRequest({});
      expect(getIP(req)).toBe("127.0.0.1");
    });

    it("extracts first IP from comma-separated x-forwarded-for", () => {
      const req = buildRequest({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 172.16.0.1" });
      expect(getIP(req)).toBe("9.9.9.9");
    });
  });

  describe("banlist bypass regression (#29851)", () => {
    const originalBanlist = process.env.IP_BANLIST;

    afterEach(() => {
      if (originalBanlist === undefined) {
        delete process.env.IP_BANLIST;
      } else {
        process.env.IP_BANLIST = originalBanlist;
      }
    });

    it("still detects a banned IP when x-forwarded-for is padded with whitespace", () => {
      process.env.IP_BANLIST = JSON.stringify(["1.2.3.4"]);
      const req = buildRequest({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" });
      expect(isIpInBanlist(req)).toBe(true);
    });

    it("Flowko: a spoofed cf-connecting-ip cannot evade the banlist without the opt-in", () => {
      process.env.IP_BANLIST = JSON.stringify(["1.2.3.4"]);
      const req = buildRequest({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" });
      expect(isIpInBanlist(req)).toBe(true);
    });

    it("Flowko: bans the Cloudflare client IP when TRUST_CLOUDFLARE_IP_HEADERS=true", () => {
      vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", "true");
      process.env.IP_BANLIST = JSON.stringify(["1.2.3.4"]);
      const req = buildRequest({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" });
      expect(isIpInBanlist(req)).toBe(true);
    });
  });

  describe("with NextApiRequest", () => {
    describe("with TRUST_CLOUDFLARE_IP_HEADERS=true", () => {
      beforeEach(() => {
        vi.stubEnv("TRUST_CLOUDFLARE_IP_HEADERS", "true");
      });

      it("returns cf-connecting-ip when present", () => {
        const req = buildNextApiRequest({ "cf-connecting-ip": "1.1.1.1" });
        expect(getIP(req)).toBe("1.1.1.1");
      });

      it("prefers cf-connecting-ip over other headers", () => {
        const req = buildNextApiRequest({
          "cf-connecting-ip": "1.1.1.1",
          "true-client-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3",
          "x-real-ip": "4.4.4.4",
        });
        expect(getIP(req)).toBe("1.1.1.1");
      });

      it("falls back to true-client-ip when cf-connecting-ip is absent", () => {
        const req = buildNextApiRequest({
          "true-client-ip": "2.2.2.2",
          "x-real-ip": "4.4.4.4",
        });
        expect(getIP(req)).toBe("2.2.2.2");
      });
    });

    describe("without TRUST_CLOUDFLARE_IP_HEADERS (Flowko default: no Cloudflare in front)", () => {
      it("ignores a spoofed cf-connecting-ip and uses x-forwarded-for", () => {
        const req = buildNextApiRequest({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "3.3.3.3" });
        expect(getIP(req)).toBe("3.3.3.3");
      });

      it("ignores a spoofed true-client-ip and uses x-real-ip", () => {
        const req = buildNextApiRequest({ "true-client-ip": "203.0.113.8", "x-real-ip": "4.4.4.4" });
        expect(getIP(req)).toBe("4.4.4.4");
      });

      it("ignores array-valued Cloudflare headers", () => {
        const req = buildNextApiRequest({
          "cf-connecting-ip": ["1.1.1.1"],
          "true-client-ip": ["2.2.2.2"],
          "x-forwarded-for": ["5.5.5.5", "6.6.6.6"],
        });
        expect(getIP(req)).toBe("5.5.5.5");
      });

      it("returns 127.0.0.1 when only Cloudflare headers are sent", () => {
        const req = buildNextApiRequest({ "cf-connecting-ip": "1.1.1.1", "true-client-ip": "2.2.2.2" });
        expect(getIP(req)).toBe("127.0.0.1");
      });
    });

    it("falls back to x-forwarded-for when cf and true-client headers are absent", () => {
      const req = buildNextApiRequest({
        "x-forwarded-for": "3.3.3.3, 10.0.0.1",
        "x-real-ip": "4.4.4.4",
      });
      expect(getIP(req)).toBe("3.3.3.3");
    });

    it("falls back to x-real-ip as last resort", () => {
      const req = buildNextApiRequest({ "x-real-ip": "4.4.4.4" });
      expect(getIP(req)).toBe("4.4.4.4");
    });

    it("returns 127.0.0.1 when no IP headers are present", () => {
      const req = buildNextApiRequest({});
      expect(getIP(req)).toBe("127.0.0.1");
    });

    it("handles array header values (NextApiRequest)", () => {
      const req = buildNextApiRequest({ "x-forwarded-for": ["5.5.5.5", "6.6.6.6"] });
      expect(getIP(req)).toBe("5.5.5.5");
    });
  });
});