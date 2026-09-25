import {
  decryptSecret,
  encryptSecret,
  getKeyMaterial,
  isKeyringConfigured,
  parseSecretEnvelope,
} from "@calcom/lib/crypto/keyring";
import logger from "@calcom/lib/logger";
import type { Prisma } from "@calcom/prisma/client";

// Flowko U9: OAuth tokens are stored encrypted at rest (Google's OAuth 2.0 Policies). Credential.key holds only
// a fixed placeholder, and the token object lives AES-256-GCM encrypted in Credential.encryptedKey. Every
// helper here fails closed: none of them ever returns or writes a plaintext key, and a stored plaintext key is
// never read as a fallback.

const log = logger.getSubLogger({ prefix: ["CredentialDataService"] });

const CREDENTIAL_KEY_PURPOSE = "Credential.key";
const FAILURE_LOG_INTERVAL_MS = 5 * 60 * 1000;
const FAILURE_LOG_MAX_ENTRIES = 10_000;

/** The value Credential.key holds for every credential whose key is encrypted. */
export type CredentialKeyPlaceholder = { _enc: "keyring-v1" };

/** Returns a new placeholder object on each call. */
export function encryptedKeyPlaceholder(): CredentialKeyPlaceholder {
  return { _enc: "keyring-v1" };
}

export function isCredentialKeyPlaceholder(value: unknown): value is CredentialKeyPlaceholder {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).length === 1 && (value as Record<string, unknown>)._enc === "keyring-v1";
}

export type CredentialKeyFailureReason =
  | "keyring_not_configured"
  | "not_encrypted"
  | "malformed_envelope"
  | "decrypt_failed";

/** A transient failure can heal once the operator fixes the keyring; a permanent one can't. */
export function isTransientCredentialKeyFailure(reason: CredentialKeyFailureReason): boolean {
  return reason === "keyring_not_configured" || reason === "decrypt_failed";
}

/** Raised for every encrypt or decrypt failure. It never carries a cause, a token or key material. */
export class CredentialKeyUnavailableError extends Error {
  public readonly reason: CredentialKeyFailureReason;
  public readonly credentialId: number | null;
  public readonly credentialType: string;

  constructor(reason: CredentialKeyFailureReason, credentialId: number | null, credentialType: string) {
    super(`Credential key unavailable (${reason}) for credential ${credentialId ?? "new"} (${credentialType})`);
    Object.setPrototypeOf(this, CredentialKeyUnavailableError.prototype);
    this.name = "CredentialKeyUnavailableError";
    this.reason = reason;
    this.credentialId = credentialId;
    this.credentialType = credentialType;
  }
}

/**
 * The AAD every credential envelope is bound to. It always emits all four properties: the keyring's
 * stableJson drops an absent property but turns an undefined one into null, so an ad-hoc object could
 * silently change the AAD.
 */
export function credentialKeyAad({
  type,
  userId,
  teamId,
}: {
  type: string;
  userId?: number | null;
  teamId?: number | null;
}): { purpose: typeof CREDENTIAL_KEY_PURPOSE; type: string; userId: number | null; teamId: number | null } {
  return { purpose: CREDENTIAL_KEY_PURPOSE, type, userId: userId ?? null, teamId: teamId ?? null };
}

/** True when a credential key can be encrypted right now. Never throws, never logs. */
export function isCredentialKeyringConfigured(): boolean {
  try {
    return isKeyringConfigured("CREDENTIALS");
  } catch {
    return false;
  }
}

// One log line per throttle key every 5 minutes, so a keyring outage on the public slots path can't flood the
// logs. The line carries ids, the type, the reason and the envelope kid only: never a token, an envelope field,
// an env value, an error object or a cause.
const lastFailureLogAt = new Map<string, number>();

function logCredentialKeyFailure(
  throttleKey: string,
  reason: CredentialKeyFailureReason,
  credentialId: number | null,
  type: string,
  fields: Record<string, string | number | null>
) {
  try {
    const now = Date.now();
    const last = lastFailureLogAt.get(throttleKey);
    if (last !== undefined && now - last < FAILURE_LOG_INTERVAL_MS) return;
    if (lastFailureLogAt.size >= FAILURE_LOG_MAX_ENTRIES) {
      // forEach, not for...of: some consumers compile this file for an es5 target
      lastFailureLogAt.forEach((at, key) => {
        if (now - at >= FAILURE_LOG_INTERVAL_MS) lastFailureLogAt.delete(key);
      });
    }
    lastFailureLogAt.set(throttleKey, now);
    log.error(`Credential key unavailable (${reason}) for credential ${credentialId ?? "new"} (${type})`, {
      credentialId,
      type,
      reason,
      ...fields,
    });
  } catch {
    // Logging must never turn a handled key failure into a different error
  }
}

function encryptCredentialKeyOrThrow({
  type,
  userId,
  teamId,
  key,
}: {
  type: string;
  userId: number | null;
  teamId: number | null;
  key: object;
}): { key: CredentialKeyPlaceholder; encryptedKey: string } {
  try {
    const envelope = encryptSecret({
      ring: "CREDENTIALS",
      plaintext: JSON.stringify(key),
      aad: credentialKeyAad({ type, userId, teamId }),
    });
    return { key: encryptedKeyPlaceholder(), encryptedKey: JSON.stringify(envelope) };
  } catch {
    const reason: CredentialKeyFailureReason = "keyring_not_configured";
    logCredentialKeyFailure(`new:${type}:${userId}:${teamId}:${reason}`, reason, null, type, { userId });
    // Flowko: throw instead of storing the plaintext key (the upstream code swallowed this and wrote plaintext)
    throw new CredentialKeyUnavailableError(reason, null, type);
  }
}

export type CredentialCreateData = {
  type: string;
  key: CredentialKeyPlaceholder;
  userId: number;
  appId: string;
  teamId?: number | null;
  delegationCredentialId?: string | null;
  encryptedKey: string;
};

/**
 * Builds the data for creating a credential: `key` is the placeholder and `encryptedKey` the envelope of the
 * given key, bound to the row's type, userId and teamId.
 *
 * @throws CredentialKeyUnavailableError when the key can't be encrypted. It never returns the plaintext key.
 */
export function buildCredentialCreateData(data: {
  type: string;
  key: object;
  userId: number;
  appId: string;
  teamId?: number | null;
  delegationCredentialId?: string | null;
}): CredentialCreateData {
  const encrypted = encryptCredentialKeyOrThrow({
    type: data.type,
    userId: data.userId,
    teamId: data.teamId ?? null,
    key: data.key,
  });
  return { ...data, key: encrypted.key, encryptedKey: encrypted.encryptedKey };
}

/**
 * Builds the data for replacing an existing credential's key (e.g. a refreshed token), bound to the row's own
 * type, userId and teamId.
 *
 * @throws CredentialKeyUnavailableError when the key can't be encrypted; the caller must then write nothing.
 */
export function buildCredentialKeyUpdateData({
  type,
  userId,
  teamId,
  key,
}: {
  type: string;
  userId: number | null;
  teamId: number | null;
  key: object;
}): { key: CredentialKeyPlaceholder; encryptedKey: string } {
  return encryptCredentialKeyOrThrow({ type, userId, teamId, key });
}

/** The fields a credential key is decrypted from. `key` is deliberately absent: it is never read. */
export type CredentialKeyRow = {
  id: number;
  type: string;
  userId: number | null;
  teamId: number | null;
  encryptedKey: string | null;
};

export type CredentialKeyDecryptResult =
  | { ok: true; key: Prisma.JsonObject; kid: string }
  | { ok: false; reason: CredentialKeyFailureReason; kid: string | null };

/**
 * Decrypts a credential's key from its envelope. It never reads `credential.key` (a plaintext key there is
 * never a fallback) and never throws; failures are logged, throttled per credential and reason.
 */
export function decryptCredentialKeyResult(credential: CredentialKeyRow): CredentialKeyDecryptResult {
  let credentialId: number | null = null;
  let type = "unknown";
  let kid: string | null = null;
  const fail = (reason: CredentialKeyFailureReason): CredentialKeyDecryptResult => {
    logCredentialKeyFailure(`${credentialId}:${reason}`, reason, credentialId, type, { kid });
    return { ok: false, reason, kid };
  };

  try {
    const { id, userId, teamId, encryptedKey } = credential;
    credentialId = id;
    type = credential.type;

    if (encryptedKey === null || encryptedKey === undefined || encryptedKey === "") return fail("not_encrypted");
    if (typeof encryptedKey !== "string") return fail("malformed_envelope");

    let envelope: ReturnType<typeof parseSecretEnvelope>;
    try {
      envelope = parseSecretEnvelope(encryptedKey);
    } catch {
      return fail("malformed_envelope");
    }
    kid = envelope.kid;

    try {
      getKeyMaterial("CREDENTIALS", envelope.kid);
    } catch {
      return fail("keyring_not_configured");
    }

    let plaintext: string;
    try {
      plaintext = decryptSecret({ envelope, aad: credentialKeyAad({ type, userId, teamId }) });
    } catch {
      return fail("decrypt_failed");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      return fail("malformed_envelope");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail("malformed_envelope");
    }

    return { ok: true, key: parsed as Prisma.JsonObject, kid: envelope.kid };
  } catch {
    // Unreachable for a well-formed credential object. Treated as transient, so a caller never deletes a grant
    // it could still revoke once the cause is fixed
    return fail("decrypt_failed");
  }
}

/** Returns the decrypted key, or throws CredentialKeyUnavailableError. */
export function decryptCredentialKey(credential: CredentialKeyRow): Prisma.JsonObject {
  const result = decryptCredentialKeyResult(credential);
  if (!result.ok) {
    throw new CredentialKeyUnavailableError(result.reason, credential.id, credential.type);
  }
  return result.key;
}

/** Returns the decrypted key, or null when it is unavailable. */
export function tryDecryptCredentialKey(credential: CredentialKeyRow): Prisma.JsonObject | null {
  const result = decryptCredentialKeyResult(credential);
  return result.ok ? result.key : null;
}
