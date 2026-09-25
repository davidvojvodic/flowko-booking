import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import process from "node:process";

type KeyringName = "CREDENTIALS";

export type SecretEnvelopeV1 = {
  v: 1;
  alg: "AES-256-GCM";
  ring: KeyringName;
  kid: string;
  nonce: string;
  ct: string;
  tag: string;
};

type AAD = Record<string, string | number | boolean | null> | Array<string | number | boolean | null>;

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJson(v)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

function aadToBuffer(aad: AAD): Buffer {
  const stable = stableJson(aad);
  return Buffer.from(stable, "utf8");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function unb64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

const envKeyringPrefix = (ring: KeyringName): string => {
  // enforce all caps ring names to match your convention (optional)
  // if you want to allow any casing, remove this check.
  if (ring !== ring.toUpperCase()) {
    throw new Error(`Keyring name must be ALL CAPS. Got: ${ring}`);
  }
  return `CALCOM_KEYRING_${ring}_`;
};

// Flowko: kids are upper-case (getKeyMaterial upper-cases them to build the variable name), at most 32 chars
const KID_PATTERN = /^[A-Z0-9_]{1,32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

const getCurrentKid = (ring: KeyringName): string => {
  const prefix = envKeyringPrefix(ring);
  const current = process.env[`${prefix}CURRENT`];
  if (!current) throw new Error(`Missing env var ${prefix}CURRENT`);
  // Flowko: refuse a CURRENT kid that parseSecretEnvelope would reject, so every envelope we write can be read
  if (!KID_PATTERN.test(current)) throw new Error(`Invalid kid in env var ${prefix}CURRENT`);
  return current;
};

/** Decodes a canonical base64url string (no padding, no other alphabet), or returns null. */
function strictUnb64url(value: unknown): Buffer | null {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return null;
  const buf = unb64url(value);
  return b64url(buf) === value ? buf : null;
}

/**
 * Flowko: checks every envelope field before any key material is touched. GCM accepts truncated tags and
 * nonces of any length, so both lengths are pinned here. The error never echoes the input.
 */
function assertEnvelopeShape(envelope: unknown): asserts envelope is SecretEnvelopeV1 {
  const malformed = () => new Error("malformed envelope");
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) throw malformed();
  const e = envelope as Record<string, unknown>;
  if (e.v !== 1 || e.alg !== "AES-256-GCM" || e.ring !== "CREDENTIALS") throw malformed();
  if (typeof e.kid !== "string" || !KID_PATTERN.test(e.kid)) throw malformed();
  const nonce = strictUnb64url(e.nonce);
  const tag = strictUnb64url(e.tag);
  if (!nonce || nonce.length !== GCM_NONCE_BYTES) throw malformed();
  if (!tag || tag.length !== GCM_TAG_BYTES) throw malformed();
  if (!strictUnb64url(e.ct)) throw malformed();
}

/**
 * Flowko: parses a stored envelope (the JSON string in Credential.encryptedKey) and validates its shape.
 * Throws Error("malformed envelope") without echoing the input.
 */
export function parseSecretEnvelope(json: string): SecretEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // JSON.parse's own message quotes the input, so it is never passed on
    throw new Error("malformed envelope");
  }
  assertEnvelopeShape(parsed);
  const { v, alg, ring, kid, nonce, ct, tag } = parsed;
  return { v, alg, ring, kid, nonce, ct, tag };
}

export function getKeyMaterial(ring: KeyringName, kid: string): Buffer {
  const prefix = envKeyringPrefix(ring);
  const raw = process.env[`${prefix}${kid.toUpperCase()}`]; // e.g. CALCOM_KEYRING_CREDENTIALS_K1
  if (!raw) throw new Error(`Unknown kid for ring=${ring}: missing env var ${prefix}${kid.toUpperCase()}`);

  const key = Buffer.from(raw, "base64url");
  if (key.length !== 32) {
    throw new Error(`Invalid key length for ring=${ring} kid=${kid}. Expected 32 bytes, got ${key.length}`);
  }
  return key;
}

/**
 * Flowko: true when CURRENT names a valid kid whose key material is present and 32 bytes long, i.e. when
 * encryptSecret can succeed. Never throws.
 */
export function isKeyringConfigured(ring: KeyringName): boolean {
  try {
    getKeyMaterial(ring, getCurrentKid(ring));
    return true;
  } catch {
    return false;
  }
}

export const encryptSecret = ({
  ring,
  plaintext,
  aad,
}: {
  ring: KeyringName;
  plaintext: string;
  aad: AAD;
}): SecretEnvelopeV1 => {
  const kid = getCurrentKid(ring);
  const key = getKeyMaterial(ring, kid);

  const nonce = randomBytes(12); // 96-bit nonce for GCM
  const aadBuf = aadToBuffer(aad);

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aadBuf);

  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: "AES-256-GCM",
    ring,
    kid,
    nonce: b64url(nonce),
    ct: b64url(ct),
    tag: b64url(tag),
  };
};

export const decryptSecret = ({ envelope, aad }: { envelope: SecretEnvelopeV1; aad: AAD }): string => {
  // Flowko: validate v, alg, ring, kid, a 12-byte nonce and a 16-byte tag before any key material is read
  assertEnvelopeShape(envelope);

  const key = getKeyMaterial(envelope.ring, envelope.kid);
  const nonce = unb64url(envelope.nonce);
  const ct = unb64url(envelope.ct);
  const tag = unb64url(envelope.tag);
  const aadBuf = aadToBuffer(aad);

  // Flowko: pin the tag length, so a truncated GCM tag can't authenticate
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: GCM_TAG_BYTES });
  decipher.setAAD(aadBuf);
  decipher.setAuthTag(tag);

  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
};

export const decryptAndMaybeReencrypt = ({
  aad,
  envelope,
}: {
  envelope: SecretEnvelopeV1;
  aad: AAD;
}): { plaintext: string; updatedEnvelope: SecretEnvelopeV1 | null } => {
  const plaintext = decryptSecret({ envelope, aad });

  const currentKid = getCurrentKid(envelope.ring);
  if (envelope.kid === currentKid) {
    return { plaintext, updatedEnvelope: null };
  }

  const updatedEnvelope = encryptSecret({
    ring: envelope.ring,
    plaintext,
    aad,
  });

  return { plaintext, updatedEnvelope };
};
