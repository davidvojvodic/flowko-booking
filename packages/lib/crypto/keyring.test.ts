import { createCipheriv } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  getKeyMaterial,
  isKeyringConfigured,
  parseSecretEnvelope,
} from "./keyring";

// Test-only key material: the bytes 0x00..0x1f, never used outside unit tests.
const TEST_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const TEST_KEY_B64URL = TEST_KEY.toString("base64url");
const AAD = { purpose: "Credential.key", type: "google_calendar", userId: 1, teamId: null };

const stubKeyring = (current = "K1", key = TEST_KEY_B64URL) => {
  vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_CURRENT", current);
  vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_K1", key);
};

// Builds a genuine AES-256-GCM envelope with a caller-chosen nonce, so the tests can prove the decrypt
// side rejects shapes that GCM itself would accept
const envelopeWithNonce = (nonce: Buffer, plaintext = "secret") => {
  const cipher = createCipheriv("aes-256-gcm", TEST_KEY, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify({ purpose: AAD.purpose, teamId: null, type: AAD.type, userId: 1 })));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    v: 1 as const,
    alg: "AES-256-GCM" as const,
    ring: "CREDENTIALS" as const,
    kid: "K1",
    nonce: nonce.toString("base64url"),
    ct: ct.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
};

describe("keyring", () => {
  beforeEach(() => {
    stubKeyring();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("encryptSecret / decryptSecret", () => {
    it("round-trips a secret and writes a 12-byte nonce and a 16-byte tag", () => {
      const envelope = encryptSecret({ ring: "CREDENTIALS", plaintext: "hello", aad: AAD });
      expect(envelope).toMatchObject({ v: 1, alg: "AES-256-GCM", ring: "CREDENTIALS", kid: "K1" });
      expect(Buffer.from(envelope.nonce, "base64url")).toHaveLength(12);
      expect(Buffer.from(envelope.tag, "base64url")).toHaveLength(16);
      expect(envelope.ct).not.toContain("hello");
      expect(decryptSecret({ envelope, aad: AAD })).toBe("hello");
    });

    it("fails when the AAD changes", () => {
      const envelope = encryptSecret({ ring: "CREDENTIALS", plaintext: "hello", aad: AAD });
      expect(() => decryptSecret({ envelope, aad: { ...AAD, userId: 2 } })).toThrow();
      expect(() => decryptSecret({ envelope, aad: { ...AAD, teamId: 5 } })).toThrow();
    });

    it("fails when one tag bit is flipped", () => {
      const envelope = encryptSecret({ ring: "CREDENTIALS", plaintext: "hello", aad: AAD });
      const tag = Buffer.from(envelope.tag, "base64url");
      tag[0] ^= 1;
      expect(() => decryptSecret({ envelope: { ...envelope, tag: tag.toString("base64url") }, aad: AAD })).toThrow();
    });

    it("rejects a GCM tag truncated to 4 bytes", () => {
      const envelope = encryptSecret({ ring: "CREDENTIALS", plaintext: "hello", aad: AAD });
      const truncated = Buffer.from(envelope.tag, "base64url").subarray(0, 4).toString("base64url");
      expect(() => decryptSecret({ envelope: { ...envelope, tag: truncated }, aad: AAD })).toThrow();
    });

    it("rejects a 16-byte nonce even when the ciphertext is otherwise valid", () => {
      const envelope = envelopeWithNonce(Buffer.alloc(16, 9));
      expect(() => decryptSecret({ envelope, aad: AAD })).toThrow();
      // Control: the same construction with a 12-byte nonce decrypts
      expect(decryptSecret({ envelope: envelopeWithNonce(Buffer.alloc(12, 9)), aad: AAD })).toBe("secret");
    });

    it("validates the envelope before any key material is read", () => {
      vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_K1", "");
      const envelope = envelopeWithNonce(Buffer.alloc(12, 9));
      // A malformed kid is refused as a malformed envelope, not reported as a missing key
      expect(() => decryptSecret({ envelope: { ...envelope, kid: "k1" }, aad: AAD })).toThrow(
        "malformed envelope"
      );
      expect(() => decryptSecret({ envelope, aad: AAD })).toThrow(/missing env var/);
    });

    it("upper-cases the kid when the variable name is built", () => {
      expect(getKeyMaterial("CREDENTIALS", "k1").equals(TEST_KEY)).toBe(true);
    });

    it("refuses to encrypt under a CURRENT kid that its own envelopes could not carry", () => {
      stubKeyring("k1");
      expect(() => encryptSecret({ ring: "CREDENTIALS", plaintext: "hello", aad: AAD })).toThrow();
    });
  });

  describe("isKeyringConfigured", () => {
    it("is true for a 32-byte key under CURRENT", () => {
      expect(isKeyringConfigured("CREDENTIALS")).toBe(true);
    });

    it("is false when CURRENT is unset", () => {
      vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_CURRENT", "");
      expect(isKeyringConfigured("CREDENTIALS")).toBe(false);
    });

    it("is false when the kid variable is missing", () => {
      stubKeyring("K2");
      expect(isKeyringConfigured("CREDENTIALS")).toBe(false);
    });

    it("is false for a 31-byte key", () => {
      stubKeyring("K1", TEST_KEY.subarray(0, 31).toString("base64url"));
      expect(isKeyringConfigured("CREDENTIALS")).toBe(false);
    });

    it("is false for a CURRENT kid that is not upper-case", () => {
      stubKeyring("k1");
      expect(isKeyringConfigured("CREDENTIALS")).toBe(false);
    });

    it("never throws, even for an invalid ring name", () => {
      expect(() =>
        isKeyringConfigured("credentials" as unknown as Parameters<typeof isKeyringConfigured>[0])
      ).not.toThrow();
    });
  });

  describe("parseSecretEnvelope", () => {
    const valid = () => envelopeWithNonce(Buffer.alloc(12, 3));

    it("returns the envelope fields for a valid envelope", () => {
      const envelope = valid();
      expect(parseSecretEnvelope(JSON.stringify({ ...envelope, extra: "ignored" }))).toEqual(envelope);
    });

    it.each([
      ["not JSON", "{secret-token-value"],
      ["JSON null", "null"],
      ["an array", "[]"],
    ])("rejects %s without echoing the input", (_label, json) => {
      let message = "";
      try {
        parseSecretEnvelope(json);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toBe("malformed envelope");
    });

    it.each([
      ["v", { v: 2 }],
      ["alg", { alg: "AES-128-GCM" }],
      ["ring", { ring: "OTHER" }],
      ["lower-case kid", { kid: "k1" }],
      ["empty kid", { kid: "" }],
      ["33-char kid", { kid: "K".repeat(33) }],
      ["16-byte nonce", { nonce: Buffer.alloc(16).toString("base64url") }],
      ["4-byte tag", { tag: Buffer.alloc(4).toString("base64url") }],
      ["standard base64 in ct", { ct: "ab+/" }],
      ["missing ct", { ct: undefined }],
      ["numeric nonce", { nonce: 12 }],
    ])("rejects a bad %s", (_label, patch) => {
      expect(() => parseSecretEnvelope(JSON.stringify({ ...valid(), ...patch }))).toThrow(
        "malformed envelope"
      );
    });
  });
});
