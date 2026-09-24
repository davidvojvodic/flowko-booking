import crypto from "node:crypto";

const ALGORITHM = "aes256";
const INPUT_ENCODING = "utf8";
const OUTPUT_ENCODING = "hex";
const IV_LENGTH = 16; // AES blocksize

// Flowko: authenticated encryption for tokens that carry authority, such as the /api/link
// confirm/reject magic link (NAR-1). symmetricEncrypt/symmetricDecrypt below are AES-256-CBC with no
// MAC: a tampered token either decrypts to attacker-shaped plaintext or leaks a padding oracle. They
// also protect stored secrets (2FA secrets, backup codes, credential keys), so their format must never
// change. symmetricEncryptAuthenticated/symmetricDecryptAuthenticated are separate: AES-256-GCM with a
// random 12-byte IV and a 16-byte auth tag, under a key derived from `key` with HKDF-SHA256 and a
// per-purpose `label`, so a token key is never the key that protects stored secrets, and two purposes
// never share a key.
const AUTHENTICATED_ALGORITHM = "aes-256-gcm";
const AUTHENTICATED_IV_LENGTH = 12;
const AUTHENTICATED_TAG_LENGTH = 16;
const AUTHENTICATED_KEY_LENGTH = 32;
const AUTHENTICATED_TOKEN_ENCODING = "base64url";
const AUTHENTICATED_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

const deriveAuthenticatedKey = (key: string, label: string): Buffer => {
  const _key = Buffer.from(key, "latin1");
  // Flowko: fail closed on a missing or short key; HKDF would otherwise happily derive a key from "".
  if (_key.length !== AUTHENTICATED_KEY_LENGTH) throw new Error("Invalid key length");
  if (!label) throw new Error("Missing key label");
  return Buffer.from(crypto.hkdfSync("sha256", _key, Buffer.alloc(0), label, AUTHENTICATED_KEY_LENGTH));
};

/**
 *
 * @param text Value to be encrypted
 * @param key Key used to encrypt value must be 32 bytes for AES256 encryption algorithm
 *
 * @returns Encrypted value using key
 */
export const symmetricEncrypt = function (text: string, key: string) {
  const _key = Buffer.from(key, "latin1");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, _key, iv);
  let ciphered = cipher.update(text, INPUT_ENCODING, OUTPUT_ENCODING);
  ciphered += cipher.final(OUTPUT_ENCODING);
  const ciphertext = `${iv.toString(OUTPUT_ENCODING)}:${ciphered}`;

  return ciphertext;
};

/**
 *
 * @param text Value to decrypt
 * @param key Key used to decrypt value must be 32 bytes for AES256 encryption algorithm
 */
export const symmetricDecrypt = function (text: string, key: string) {
  const _key = Buffer.from(key, "latin1");

  const components = text.split(":");
  const iv_from_ciphertext = Buffer.from(components.shift() || "", OUTPUT_ENCODING);
  const decipher = crypto.createDecipheriv(ALGORITHM, _key, iv_from_ciphertext);
  let deciphered = decipher.update(components.join(":"), OUTPUT_ENCODING, INPUT_ENCODING);
  deciphered += decipher.final(INPUT_ENCODING);

  return deciphered;
};

/** HKDF label for the organizer confirm/reject link token (OrganizerRequestEmail -> /api/link). */
export const LINK_TOKEN_KEY_LABEL = "flowko:link-token";

/**
 *
 * @param text Value to be encrypted
 * @param key Key material (32 bytes, e.g. CALENDSO_ENCRYPTION_KEY); the AES key is derived from it
 * @param label Purpose label for the key derivation, e.g. LINK_TOKEN_KEY_LABEL
 *
 * @returns URL-safe base64url token: iv (12 bytes) | ciphertext | auth tag (16 bytes)
 */
export const symmetricEncryptAuthenticated = (text: string, key: string, label: string): string => {
  const _key = deriveAuthenticatedKey(key, label);
  const iv = crypto.randomBytes(AUTHENTICATED_IV_LENGTH);
  const cipher = crypto.createCipheriv(AUTHENTICATED_ALGORITHM, _key, iv, {
    authTagLength: AUTHENTICATED_TAG_LENGTH,
  });
  const ciphered = Buffer.concat([cipher.update(text, INPUT_ENCODING), cipher.final()]);

  return Buffer.concat([iv, ciphered, cipher.getAuthTag()]).toString(AUTHENTICATED_TOKEN_ENCODING);
};

/**
 *
 * @param token Value produced by symmetricEncryptAuthenticated
 * @param key Same key material that was passed to symmetricEncryptAuthenticated
 * @param label Same purpose label that was passed to symmetricEncryptAuthenticated
 *
 * @throws on any malformed, truncated, tampered, wrong-key or wrong-label token
 */
export const symmetricDecryptAuthenticated = (token: string, key: string, label: string): string => {
  const _key = deriveAuthenticatedKey(key, label);

  // Flowko: accept exactly one spelling of a token. Buffer.from(..., "base64url") silently skips
  // invalid characters and ignores trailing bits, so re-encode and compare before trusting the bytes.
  if (!AUTHENTICATED_TOKEN_PATTERN.test(token)) throw new Error("Invalid token");
  const raw = Buffer.from(token, AUTHENTICATED_TOKEN_ENCODING);
  if (raw.toString(AUTHENTICATED_TOKEN_ENCODING) !== token) throw new Error("Invalid token");
  if (raw.length < AUTHENTICATED_IV_LENGTH + AUTHENTICATED_TAG_LENGTH) throw new Error("Invalid token");

  const iv = raw.subarray(0, AUTHENTICATED_IV_LENGTH);
  const tag = raw.subarray(raw.length - AUTHENTICATED_TAG_LENGTH);
  const ciphered = raw.subarray(AUTHENTICATED_IV_LENGTH, raw.length - AUTHENTICATED_TAG_LENGTH);

  // Flowko: pin the tag length, so a truncated tag can never be accepted.
  const decipher = crypto.createDecipheriv(AUTHENTICATED_ALGORITHM, _key, iv, {
    authTagLength: AUTHENTICATED_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  // final() throws when the tag does not verify; no plaintext is returned before that.
  const deciphered = Buffer.concat([decipher.update(ciphered), decipher.final()]);

  return deciphered.toString(INPUT_ENCODING);
};
