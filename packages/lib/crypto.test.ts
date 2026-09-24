import { describe, expect, it } from "vitest";

import crypto from "node:crypto";

import {
  LINK_TOKEN_KEY_LABEL,
  symmetricDecrypt,
  symmetricDecryptAuthenticated,
  symmetricEncrypt,
  symmetricEncryptAuthenticated,
} from "./crypto";

describe("crypto", () => {
  const testKey = "12345678901234567890123456789012"; // 32 bytes key
  const testText = "Hello, World!";

  describe("symmetricEncrypt", () => {
    it("should encrypt text with a valid key", () => {
      const encrypted = symmetricEncrypt(testText, testKey);

      // Verify the format is "iv:ciphertext"
      expect(encrypted).toContain(":");
      const [iv, ciphertext] = encrypted.split(":");

      // IV should be 32 characters (16 bytes in hex)
      expect(iv).toHaveLength(32);
      // Ciphertext should exist
      expect(ciphertext).toBeDefined();
      expect(ciphertext.length).toBeGreaterThan(0);
    });

    it("should produce different ciphertexts for the same input due to random IV", () => {
      const encrypted1 = symmetricEncrypt(testText, testKey);
      const encrypted2 = symmetricEncrypt(testText, testKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should throw error if key is not 32 bytes", () => {
      const shortKey = "short";
      expect(() => symmetricEncrypt(testText, shortKey)).toThrow();
    });
  });

  describe("symmetricDecrypt", () => {
    it("should correctly decrypt encrypted text", () => {
      const encrypted = symmetricEncrypt(testText, testKey);
      const decrypted = symmetricDecrypt(encrypted, testKey);

      expect(decrypted).toBe(testText);
    });

    it("should throw error for malformed encrypted text", () => {
      // Test with invalid IV:ciphertext format
      expect(() => symmetricDecrypt("invalid", testKey)).toThrow();
      expect(() => symmetricDecrypt("invalid:data", testKey)).toThrow();
      expect(() => symmetricDecrypt(":", testKey)).toThrow();
    });

    it("should fail to decrypt correctly if wrong key is used", () => {
      const encrypted = symmetricEncrypt(testText, testKey);
      const wrongKey = "12345678901234567890123456789013"; // Different 32 bytes key

      // AES-256-CBC doesn't guarantee throwing on wrong key - it depends on whether
      // the decrypted bytes happen to have valid PKCS#7 padding. The test verifies
      // that decryption either throws OR returns a value different from the original.
      let decryptedWithWrongKey: string | null = null;
      let threwError = false;

      try {
        decryptedWithWrongKey = symmetricDecrypt(encrypted, wrongKey);
      } catch {
        threwError = true;
      }

      // Either it threw an error, or the decrypted value is not the original text
      expect(threwError || decryptedWithWrongKey !== testText).toBe(true);
    });

    it("should handle empty string encryption/decryption", () => {
      const emptyText = "";
      const encrypted = symmetricEncrypt(emptyText, testKey);
      const decrypted = symmetricDecrypt(encrypted, testKey);

      expect(decrypted).toBe(emptyText);
    });

    it("should handle long text encryption/decryption", () => {
      const longText = "a".repeat(1000);
      const encrypted = symmetricEncrypt(longText, testKey);
      const decrypted = symmetricDecrypt(encrypted, testKey);

      expect(decrypted).toBe(longText);
    });

    it("should handle special characters", () => {
      const specialChars = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/\\`~";
      const encrypted = symmetricEncrypt(specialChars, testKey);
      const decrypted = symmetricDecrypt(encrypted, testKey);

      expect(decrypted).toBe(specialChars);
    });

    it("should handle unicode characters", () => {
      const unicodeText = "Hello, 世界! 👋 🌍";
      const encrypted = symmetricEncrypt(unicodeText, testKey);
      const decrypted = symmetricDecrypt(encrypted, testKey);

      expect(decrypted).toBe(unicodeText);
    });
  });
  // Flowko: NAR-1. The authenticated variants must reject every tampered, foreign or legacy token.
  describe("symmetricEncryptAuthenticated / symmetricDecryptAuthenticated", () => {
    const label = LINK_TOKEN_KEY_LABEL;
    const payload = JSON.stringify({ bookingUid: "booking-a", userId: 7 });

    const flipChar = (token: string, i: number): string => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const next = alphabet[(alphabet.indexOf(token[i]) + 1) % alphabet.length];
      return token.slice(0, i) + next + token.slice(i + 1);
    };

    it("round-trips text and emits a URL-safe token", () => {
      const token = symmetricEncryptAuthenticated(payload, testKey, label);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(symmetricDecryptAuthenticated(token, testKey, label)).toBe(payload);
    });

    it("round-trips empty and unicode text", () => {
      for (const text of ["", "Hello, 世界! 👋 🌍", "a".repeat(1000)]) {
        const token = symmetricEncryptAuthenticated(text, testKey, label);
        expect(symmetricDecryptAuthenticated(token, testKey, label)).toBe(text);
      }
    });

    it("uses a random IV", () => {
      expect(symmetricEncryptAuthenticated(payload, testKey, label)).not.toBe(
        symmetricEncryptAuthenticated(payload, testKey, label)
      );
    });

    it("rejects a token with any single character changed", () => {
      const token = symmetricEncryptAuthenticated(payload, testKey, label);
      for (let i = 0; i < token.length; i++) {
        expect(() => symmetricDecryptAuthenticated(flipChar(token, i), testKey, label)).toThrow();
      }
    });

    it("rejects a token with any single bit of the decoded bytes flipped", () => {
      const raw = Buffer.from(symmetricEncryptAuthenticated(payload, testKey, label), "base64url");
      for (let i = 0; i < raw.length; i++) {
        for (let bit = 0; bit < 8; bit++) {
          const tampered = Buffer.from(raw);
          tampered[i] ^= 1 << bit;
          expect(() =>
            symmetricDecryptAuthenticated(tampered.toString("base64url"), testKey, label)
          ).toThrow();
        }
      }
    });

    it("rejects truncated, extended and empty tokens", () => {
      const token = symmetricEncryptAuthenticated(payload, testKey, label);
      const raw = Buffer.from(token, "base64url");
      expect(() => symmetricDecryptAuthenticated("", testKey, label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(token.slice(0, -1), testKey, label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(`${token}A`, testKey, label)).toThrow();
      expect(() =>
        symmetricDecryptAuthenticated(raw.subarray(0, raw.length - 1).toString("base64url"), testKey, label)
      ).toThrow();
      // a tag-only-length token (IV + 16 bytes, no ciphertext) forged from random bytes
      expect(() =>
        symmetricDecryptAuthenticated(crypto.randomBytes(28).toString("base64url"), testKey, label)
      ).toThrow();
    });

    it("rejects a non-canonical spelling of a valid token", () => {
      const token = symmetricEncryptAuthenticated(payload, testKey, label);
      expect(() => symmetricDecryptAuthenticated(` ${token}`, testKey, label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(`${token}=`, testKey, label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(token.replace(/_/g, "/"), testKey, label)).toThrow();
    });

    it("rejects a token under a different key or a different label", () => {
      const token = symmetricEncryptAuthenticated(payload, testKey, label);
      expect(() => symmetricDecryptAuthenticated(token, "12345678901234567890123456789013", label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(token, testKey, "flowko:other-purpose")).toThrow();
    });

    it("does not encrypt under the raw key (the key that protects stored secrets)", () => {
      const raw = Buffer.from(symmetricEncryptAuthenticated(payload, testKey, label), "base64url");
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        Buffer.from(testKey, "latin1"),
        raw.subarray(0, 12)
      );
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      decipher.update(raw.subarray(12, raw.length - 16));
      expect(() => decipher.final()).toThrow();
    });

    it("rejects a legacy AES-256-CBC token from symmetricEncrypt", () => {
      const legacy = symmetricEncrypt(payload, testKey);
      expect(() => symmetricDecryptAuthenticated(legacy, testKey, label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(encodeURIComponent(legacy), testKey, label)).toThrow();
    });

    it("fails closed on a missing or wrong-length key and a missing label", () => {
      expect(() => symmetricEncryptAuthenticated(payload, "", label)).toThrow();
      expect(() => symmetricEncryptAuthenticated(payload, "short", label)).toThrow();
      expect(() => symmetricEncryptAuthenticated(payload, testKey, "")).toThrow();
      const token = symmetricEncryptAuthenticated(payload, testKey, label);
      expect(() => symmetricDecryptAuthenticated(token, "", label)).toThrow();
      expect(() => symmetricDecryptAuthenticated(token, testKey, "")).toThrow();
    });

    it("leaves symmetricEncrypt's stored-secret format unchanged", () => {
      const encrypted = symmetricEncrypt(testText, testKey);
      expect(encrypted).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
      expect(symmetricDecrypt(encrypted, testKey)).toBe(testText);
    });
  });
});
