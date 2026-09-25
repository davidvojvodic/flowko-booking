import prismock from "@calcom/testing/lib/__mocks__/prisma";
import {
  decryptTestCredentialKey,
  encryptedTestCredentialFields,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import { encryptSecret } from "@calcom/lib/crypto/keyring";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialRepository } from "../repositories/CredentialRepository";
import {
  buildCredentialCreateData,
  buildCredentialKeyUpdateData,
  credentialKeyAad,
  CredentialKeyUnavailableError,
  decryptCredentialKey,
  decryptCredentialKeyResult,
  encryptedKeyPlaceholder,
  isCredentialKeyPlaceholder,
  isCredentialKeyringConfigured,
  isTransientCredentialKeyFailure,
  tryDecryptCredentialKey,
} from "./CredentialDataService";

const { serviceLogError, serviceLogOther } = vi.hoisted(() => ({
  serviceLogError: vi.fn(),
  serviceLogOther: vi.fn(),
}));

vi.mock("@calcom/lib/logger", () => {
  const quiet = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), silly: vi.fn(), log: vi.fn() };
  const service = {
    error: serviceLogError,
    warn: serviceLogOther,
    info: serviceLogOther,
    debug: serviceLogOther,
    silly: serviceLogOther,
    log: serviceLogOther,
  };
  return {
    default: {
      ...quiet,
      getSubLogger: ({ prefix }: { prefix?: string[] }) =>
        prefix?.[0] === "CredentialDataService" ? service : quiet,
    },
  };
});

const TOKEN = {
  access_token: "ya29.test-access-token",
  refresh_token: "1//test-refresh-token",
  scope: "https://www.googleapis.com/auth/calendar.events",
  token_type: "Bearer",
  expiry_date: 1_900_000_000_000,
};

// Each test uses its own ids, because failure logs are throttled per credential for 5 minutes
let nextId = 1000;
const newId = () => ++nextId;

const encryptedRow = ({
  id = newId(),
  type = "google_calendar",
  userId = 1 as number | null,
  teamId = null as number | null,
  key = TOKEN as object,
} = {}) => ({ id, type, userId, teamId, ...encryptedTestCredentialFields({ type, userId, teamId, key }) });

describe("CredentialDataService", () => {
  beforeEach(() => {
    stubTestCredentialKeyring();
    serviceLogError.mockClear();
    serviceLogOther.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("placeholder, reasons and AAD", () => {
    it("returns a new placeholder object on every call, and recognises only that shape", () => {
      const a = encryptedKeyPlaceholder();
      const b = encryptedKeyPlaceholder();
      expect(a).toEqual({ _enc: "keyring-v1" });
      expect(a).not.toBe(b);
      expect(isCredentialKeyPlaceholder(a)).toBe(true);
      expect(isCredentialKeyPlaceholder({ _enc: "keyring-v1", access_token: "x" })).toBe(false);
      expect(isCredentialKeyPlaceholder({ _enc: "keyring-v2" })).toBe(false);
      expect(isCredentialKeyPlaceholder(TOKEN)).toBe(false);
      expect(isCredentialKeyPlaceholder(null)).toBe(false);
      expect(isCredentialKeyPlaceholder("keyring-v1")).toBe(false);
    });

    it("classifies keyring_not_configured and decrypt_failed as transient, the others as permanent", () => {
      expect(isTransientCredentialKeyFailure("keyring_not_configured")).toBe(true);
      expect(isTransientCredentialKeyFailure("decrypt_failed")).toBe(true);
      expect(isTransientCredentialKeyFailure("not_encrypted")).toBe(false);
      expect(isTransientCredentialKeyFailure("malformed_envelope")).toBe(false);
    });

    it("always emits all four AAD properties", () => {
      expect(credentialKeyAad({ type: "google_calendar" })).toEqual({
        purpose: "Credential.key",
        type: "google_calendar",
        userId: null,
        teamId: null,
      });
      expect(credentialKeyAad({ type: "google_calendar", userId: 3, teamId: undefined })).toEqual({
        purpose: "Credential.key",
        type: "google_calendar",
        userId: 3,
        teamId: null,
      });
    });

    it("builds the error message from the reason, the id and the type, with no cause", () => {
      const error = new CredentialKeyUnavailableError("decrypt_failed", 7, "google_calendar");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
      expect(error.message).toBe("Credential key unavailable (decrypt_failed) for credential 7 (google_calendar)");
      expect(error).toMatchObject({ reason: "decrypt_failed", credentialId: 7, credentialType: "google_calendar" });
      expect(error.cause).toBeUndefined();
      expect(new CredentialKeyUnavailableError("keyring_not_configured", null, "google_calendar").message).toBe(
        "Credential key unavailable (keyring_not_configured) for credential new (google_calendar)"
      );
    });
  });

  describe("isCredentialKeyringConfigured", () => {
    it("reports the keyring state without throwing or logging", () => {
      expect(isCredentialKeyringConfigured()).toBe(true);
      stubMissingCredentialKeyring();
      expect(isCredentialKeyringConfigured()).toBe(false);
      expect(serviceLogError).not.toHaveBeenCalled();
      expect(serviceLogOther).not.toHaveBeenCalled();
    });
  });

  describe("buildCredentialCreateData", () => {
    it("stores only the placeholder in key and an envelope that decrypts to the token", () => {
      const result = buildCredentialCreateData({
        type: "google_calendar",
        key: TOKEN,
        userId: 1,
        appId: "google-calendar",
      });

      expect(result.key).toEqual(encryptedKeyPlaceholder());
      expect(JSON.stringify(result.key)).not.toMatch(/access_token|refresh_token/);
      expect(result).toMatchObject({ type: "google_calendar", userId: 1, appId: "google-calendar" });
      expect(result.encryptedKey).not.toContain(TOKEN.access_token);
      expect(result.encryptedKey).not.toContain(TOKEN.refresh_token);
      expect(JSON.parse(result.encryptedKey)).toMatchObject({ v: 1, alg: "AES-256-GCM", ring: "CREDENTIALS" });
      expect(decryptTestCredentialKey({ ...result, teamId: null })).toEqual(TOKEN);
    });

    it("binds the envelope to the teamId it is given", () => {
      const result = buildCredentialCreateData({
        type: "google_calendar",
        key: TOKEN,
        userId: 1,
        appId: "google-calendar",
        teamId: 9,
      });
      expect(result.teamId).toBe(9);
      expect(decryptTestCredentialKey({ ...result, teamId: 9 })).toEqual(TOKEN);
      expect(() => decryptTestCredentialKey({ ...result, teamId: null })).toThrow();
    });

    it("throws CredentialKeyUnavailableError and returns no plaintext when the keyring is missing", () => {
      stubMissingCredentialKeyring();
      let result: unknown;
      let error: unknown;
      try {
        result = buildCredentialCreateData({
          type: "google_calendar",
          key: TOKEN,
          userId: 424_242,
          appId: "google-calendar",
        });
      } catch (e) {
        error = e;
      }

      expect(result).toBeUndefined();
      expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
      expect(error).toMatchObject({
        reason: "keyring_not_configured",
        credentialId: null,
        credentialType: "google_calendar",
      });
      expect(JSON.stringify(error)).not.toContain(TOKEN.access_token);
      expect(serviceLogError).toHaveBeenCalledTimes(1);
      expect(serviceLogError).toHaveBeenCalledWith(
        "Credential key unavailable (keyring_not_configured) for credential new (google_calendar)",
        { credentialId: null, type: "google_calendar", reason: "keyring_not_configured", userId: 424_242 }
      );
    });
  });

  describe("buildCredentialKeyUpdateData", () => {
    it("returns the placeholder and an envelope bound to the row's own type, userId and teamId", () => {
      const data = buildCredentialKeyUpdateData({ type: "google_calendar", userId: 4, teamId: 5, key: TOKEN });
      expect(Object.keys(data).sort()).toEqual(["encryptedKey", "key"]);
      expect(data.key).toEqual(encryptedKeyPlaceholder());
      expect(decryptTestCredentialKey({ type: "google_calendar", userId: 4, teamId: 5, ...data })).toEqual(TOKEN);
    });

    it("throws instead of returning plaintext when the keyring is missing", () => {
      stubMissingCredentialKeyring();
      expect(() =>
        buildCredentialKeyUpdateData({ type: "google_calendar", userId: 434_343, teamId: null, key: TOKEN })
      ).toThrow(CredentialKeyUnavailableError);
    });
  });

  describe("decryptCredentialKeyResult", () => {
    it("decrypts an encrypted row and reports its kid", () => {
      expect(decryptCredentialKeyResult(encryptedRow())).toEqual({ ok: true, key: TOKEN, kid: "KTEST" });
    });

    it("fails an envelope built for userId 1 when the row belongs to userId 2", () => {
      const row = encryptedRow({ userId: 1 });
      expect(decryptCredentialKeyResult({ ...row, userId: 2 })).toEqual({
        ok: false,
        reason: "decrypt_failed",
        kid: "KTEST",
      });
    });

    it("fails an envelope built for teamId null when the row has a teamId, and the reverse", () => {
      const personal = encryptedRow({ teamId: null });
      expect(decryptCredentialKeyResult({ ...personal, teamId: 3 })).toMatchObject({
        ok: false,
        reason: "decrypt_failed",
      });
      const team = encryptedRow({ userId: null, teamId: 3 });
      expect(decryptCredentialKeyResult({ ...team, teamId: null })).toMatchObject({
        ok: false,
        reason: "decrypt_failed",
      });
    });

    it("fails an envelope moved to another credential type", () => {
      const row = encryptedRow({ type: "google_calendar" });
      expect(decryptCredentialKeyResult({ ...row, type: "google_video" })).toMatchObject({
        ok: false,
        reason: "decrypt_failed",
      });
    });

    it("refuses a plaintext-key row with a null envelope, and never reads key", () => {
      const keyRead = vi.fn();
      const row = {
        id: newId(),
        type: "google_calendar",
        userId: 1,
        teamId: null,
        encryptedKey: null,
        get key() {
          keyRead();
          return TOKEN;
        },
      };

      const result = decryptCredentialKeyResult(row);
      expect(result).toEqual({ ok: false, reason: "not_encrypted", kid: null });
      expect(result).not.toHaveProperty("key");
      expect(keyRead).not.toHaveBeenCalled();
      expect(tryDecryptCredentialKey(row)).toBeNull();
      expect(() => decryptCredentialKey(row)).toThrow(CredentialKeyUnavailableError);
      expect(keyRead).not.toHaveBeenCalled();
    });

    it("never reads key on success either", () => {
      const keyRead = vi.fn();
      const row = encryptedRow();
      const withGetter = {
        ...row,
        get key() {
          keyRead();
          return TOKEN;
        },
      };
      expect(decryptCredentialKeyResult(withGetter)).toMatchObject({ ok: true });
      expect(keyRead).not.toHaveBeenCalled();
    });

    describe("maps every failure to its reason", () => {
      const base = () => ({ id: newId(), type: "google_calendar", userId: 1, teamId: null });

      it.each([
        ["a null envelope", null],
        ["an empty envelope", ""],
      ])("%s -> not_encrypted", (_label, encryptedKey) => {
        expect(decryptCredentialKeyResult({ ...base(), encryptedKey })).toEqual({
          ok: false,
          reason: "not_encrypted",
          kid: null,
        });
      });

      it.each([
        ["text that is not JSON", "not-json"],
        ["a JSON value that is not an envelope", '{"_enc":"keyring-v1"}'],
        ["an envelope with a truncated tag", "TRUNCATED_TAG"],
      ])("%s -> malformed_envelope", (_label, value) => {
        let encryptedKey = value;
        if (value === "TRUNCATED_TAG") {
          const envelope = JSON.parse(encryptedRow().encryptedKey);
          envelope.tag = Buffer.from(envelope.tag, "base64url").subarray(0, 4).toString("base64url");
          encryptedKey = JSON.stringify(envelope);
        }
        expect(decryptCredentialKeyResult({ ...base(), encryptedKey })).toEqual({
          ok: false,
          reason: "malformed_envelope",
          kid: null,
        });
      });

      it.each([
        ["a JSON array", "[1,2]"],
        ["a JSON string", '"ya29.x"'],
        ["JSON null", "null"],
        ["text that is not JSON", "ya29.x"],
      ])("plaintext that is %s -> malformed_envelope", (_label, plaintext) => {
        const row = base();
        const envelope = encryptSecret({ ring: "CREDENTIALS", plaintext, aad: credentialKeyAad(row) });
        expect(decryptCredentialKeyResult({ ...row, encryptedKey: JSON.stringify(envelope) })).toEqual({
          ok: false,
          reason: "malformed_envelope",
          kid: "KTEST",
        });
      });

      it("a missing keyring -> keyring_not_configured", () => {
        const row = encryptedRow();
        stubMissingCredentialKeyring();
        expect(decryptCredentialKeyResult(row)).toEqual({
          ok: false,
          reason: "keyring_not_configured",
          kid: "KTEST",
        });
      });

      it("key material that is not 32 bytes -> keyring_not_configured", () => {
        const row = encryptedRow();
        vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_KTEST", Buffer.alloc(31, 1).toString("base64url"));
        expect(decryptCredentialKeyResult(row)).toMatchObject({ ok: false, reason: "keyring_not_configured" });
      });

      it("another key under the same kid -> decrypt_failed", () => {
        const row = encryptedRow();
        vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_KTEST", Buffer.alloc(32, 7).toString("base64url"));
        expect(decryptCredentialKeyResult(row)).toEqual({ ok: false, reason: "decrypt_failed", kid: "KTEST" });
      });

      it("a flipped ciphertext bit -> decrypt_failed", () => {
        const row = encryptedRow();
        const envelope = JSON.parse(row.encryptedKey);
        const ct = Buffer.from(envelope.ct, "base64url");
        ct[0] ^= 1;
        envelope.ct = ct.toString("base64url");
        expect(decryptCredentialKeyResult({ ...row, encryptedKey: JSON.stringify(envelope) })).toMatchObject({
          ok: false,
          reason: "decrypt_failed",
        });
      });
    });

    it("decryptCredentialKey throws the typed error and tryDecryptCredentialKey returns null", () => {
      const row = encryptedRow();
      expect(decryptCredentialKey(row)).toEqual(TOKEN);
      expect(tryDecryptCredentialKey(row)).toEqual(TOKEN);

      stubMissingCredentialKeyring();
      expect(tryDecryptCredentialKey(row)).toBeNull();
      let error: unknown;
      try {
        decryptCredentialKey(row);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
      expect(error).toMatchObject({
        reason: "keyring_not_configured",
        credentialId: row.id,
        credentialType: "google_calendar",
        message: `Credential key unavailable (keyring_not_configured) for credential ${row.id} (google_calendar)`,
      });
      expect((error as Error).cause).toBeUndefined();
    });
  });

  describe("failure logging", () => {
    it("logs ids, type, reason and kid only: no token, no envelope field, no env value", () => {
      const row = encryptedRow();
      const envelope = JSON.parse(row.encryptedKey);
      const keyMaterial = process.env.CALCOM_KEYRING_CREDENTIALS_KTEST as string;
      vi.stubEnv("CALCOM_KEYRING_CREDENTIALS_KTEST", Buffer.alloc(32, 7).toString("base64url"));
      const otherKeyMaterial = process.env.CALCOM_KEYRING_CREDENTIALS_KTEST as string;

      expect(decryptCredentialKeyResult(row)).toMatchObject({ ok: false, reason: "decrypt_failed" });

      expect(serviceLogError).toHaveBeenCalledTimes(1);
      expect(serviceLogError).toHaveBeenCalledWith(
        `Credential key unavailable (decrypt_failed) for credential ${row.id} (google_calendar)`,
        { credentialId: row.id, type: "google_calendar", reason: "decrypt_failed", kid: "KTEST" }
      );
      const args = serviceLogError.mock.calls[0];
      const logged = JSON.stringify(args);
      for (const secret of [
        TOKEN.access_token,
        TOKEN.refresh_token,
        envelope.ct,
        envelope.nonce,
        envelope.tag,
        keyMaterial,
        otherKeyMaterial,
      ]) {
        expect(logged).not.toContain(secret);
      }
      expect(args.some((arg: unknown) => arg instanceof Error)).toBe(false);
    });

    it("logs a failure once per credential and reason every 5 minutes", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const row = { id: newId(), type: "google_calendar", userId: 1, teamId: null, encryptedKey: null };

      decryptCredentialKeyResult(row);
      decryptCredentialKeyResult(row);
      expect(serviceLogError).toHaveBeenCalledTimes(1);

      // Another reason for the same credential is logged on its own
      decryptCredentialKeyResult({ ...row, encryptedKey: "not-json" });
      expect(serviceLogError).toHaveBeenCalledTimes(2);

      // Another credential is logged on its own
      decryptCredentialKeyResult({ ...row, id: newId() });
      expect(serviceLogError).toHaveBeenCalledTimes(3);

      now.mockReturnValue(1_000_000 + 5 * 60 * 1000 - 1);
      decryptCredentialKeyResult(row);
      expect(serviceLogError).toHaveBeenCalledTimes(3);

      now.mockReturnValue(1_000_000 + 5 * 60 * 1000);
      decryptCredentialKeyResult(row);
      expect(serviceLogError).toHaveBeenCalledTimes(4);
    });
  });

  describe("CredentialRepository encrypted-key writes (prismock)", () => {
    const createRow = async ({ userId, teamId }: { userId: number | null; teamId: number | null }) =>
      prismock.credential.create({
        data: {
          type: "google_calendar",
          appId: "google-calendar",
          userId,
          teamId,
          ...encryptedTestCredentialFields({ type: "google_calendar", userId, teamId, key: TOKEN }),
        },
      });

    it("creates a row from buildCredentialCreateData with the placeholder and the envelope", async () => {
      const created = await CredentialRepository.create(
        buildCredentialCreateData({ type: "google_calendar", key: TOKEN, userId: 1, appId: "google-calendar" })
      );
      const row = await prismock.credential.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.key).toEqual(encryptedKeyPlaceholder());
      expect(JSON.stringify(row.key)).not.toMatch(/access_token|refresh_token/);
      expect(decryptCredentialKey(row)).toEqual(TOKEN);
    });

    it("findKeyAadFieldsById returns exactly the AAD fields and the id", async () => {
      const row = await createRow({ userId: 1, teamId: null });
      expect(await CredentialRepository.findKeyAadFieldsById({ id: row.id })).toEqual({
        id: row.id,
        type: "google_calendar",
        userId: 1,
        teamId: null,
      });
      expect(await CredentialRepository.findKeyAadFieldsById({ id: row.id + 999 })).toBeNull();
    });

    it("stores a re-encrypted key for the row it was built for", async () => {
      const row = await createRow({ userId: 1, teamId: null });
      const fields = await CredentialRepository.findKeyAadFieldsById({ id: row.id });
      if (!fields) throw new Error("row missing");
      const refreshed = { ...TOKEN, access_token: "ya29.refreshed" };

      await CredentialRepository.updateEncryptedKeyWhereId({
        ...fields,
        data: buildCredentialKeyUpdateData({ ...fields, key: refreshed }),
      });

      const stored = await prismock.credential.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.key).toEqual(encryptedKeyPlaceholder());
      expect(stored.encryptedKey).not.toBe(row.encryptedKey);
      expect(decryptCredentialKey(stored)).toEqual(refreshed);
    });

    it("writes nothing and throws when the row's userId differs", async () => {
      const row = await createRow({ userId: 1, teamId: null });
      const data = buildCredentialKeyUpdateData({
        type: "google_calendar",
        userId: 2,
        teamId: null,
        key: { ...TOKEN, access_token: "ya29.other-user" },
      });

      await expect(
        CredentialRepository.updateEncryptedKeyWhereId({
          id: row.id,
          type: "google_calendar",
          userId: 2,
          teamId: null,
          data,
        })
      ).rejects.toThrow("credential changed; encrypted key not stored");

      const stored = await prismock.credential.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.key).toEqual(row.key);
      expect(stored.encryptedKey).toBe(row.encryptedKey);
    });

    it("writes nothing and throws when the row's teamId or type differs", async () => {
      const row = await createRow({ userId: 1, teamId: null });
      const data = buildCredentialKeyUpdateData({ type: "google_calendar", userId: 1, teamId: 4, key: TOKEN });

      await expect(
        CredentialRepository.updateEncryptedKeyWhereId({ id: row.id, type: "google_calendar", userId: 1, teamId: 4, data })
      ).rejects.toThrow("credential changed; encrypted key not stored");
      await expect(
        CredentialRepository.updateEncryptedKeyWhereId({ id: row.id, type: "google_video", userId: 1, teamId: null, data })
      ).rejects.toThrow("credential changed; encrypted key not stored");

      const stored = await prismock.credential.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.encryptedKey).toBe(row.encryptedKey);
    });
  });

  describe("test keyring helpers", () => {
    it("encrypt with the test keyring even while a missing keyring is stubbed, and leave the env as it was", () => {
      stubMissingCredentialKeyring();
      const fields = encryptedTestCredentialFields({ type: "google_calendar", userId: 1, teamId: null, key: TOKEN });
      expect(process.env.CALCOM_KEYRING_CREDENTIALS_CURRENT).toBe("");
      expect(process.env.CALCOM_KEYRING_CREDENTIALS_KTEST).toBe("");
      expect(fields.key).toEqual(encryptedKeyPlaceholder());
      expect(decryptTestCredentialKey({ type: "google_calendar", userId: 1, teamId: null, ...fields })).toEqual(
        TOKEN
      );
    });
  });
});
