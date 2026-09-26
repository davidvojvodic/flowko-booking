import process from "node:process";

import { decryptSecret, encryptSecret, parseSecretEnvelope } from "@calcom/lib/crypto/keyring";
import type { Prisma } from "@calcom/prisma/client";
import { vi } from "vitest";

// Flowko U9: a fixed keyring for unit tests only. TEST-ONLY KEY: it is the bytes 0x00..0x1f in base64url,
// protects nothing, and must never be set on any real environment.
const TEST_KID = "KTEST";
const TEST_KEY_B64URL = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

const CURRENT_ENV = "CALCOM_KEYRING_CREDENTIALS_CURRENT";
const TEST_KEY_ENV = `CALCOM_KEYRING_CREDENTIALS_${TEST_KID}`;

// Flowko U9: the placeholder and the AAD are spelled out here instead of imported from CredentialDataService,
// because @calcom/testing must not import @calcom/features (biome noRestrictedImports; features depends on
// testing). They mirror encryptedKeyPlaceholder() and credentialKeyAad(); CredentialDataService.test.ts
// round-trips rows between these helpers and the production code, so any drift fails there.
const encryptedKeyPlaceholder = (): { _enc: "keyring-v1" } => ({ _enc: "keyring-v1" });

const credentialKeyAad = ({
  type,
  userId,
  teamId,
}: {
  type: string;
  userId?: number | null;
  teamId?: number | null;
}): { purpose: "Credential.key"; type: string; userId: number | null; teamId: number | null } => ({
  purpose: "Credential.key",
  type,
  userId: userId ?? null,
  teamId: teamId ?? null,
});

// Runs fn with the test keyring in place and restores the previous env exactly, so the helpers below work at
// module scope (before a beforeEach stub) and while a test simulates a missing keyring.
function withTestKeyring<T>(fn: () => T): T {
  const previous = { current: process.env[CURRENT_ENV], key: process.env[TEST_KEY_ENV] };
  process.env[CURRENT_ENV] = TEST_KID;
  process.env[TEST_KEY_ENV] = TEST_KEY_B64URL;
  try {
    return fn();
  } finally {
    if (previous.current === undefined) delete process.env[CURRENT_ENV];
    else process.env[CURRENT_ENV] = previous.current;
    if (previous.key === undefined) delete process.env[TEST_KEY_ENV];
    else process.env[TEST_KEY_ENV] = previous.key;
  }
}

/** Makes the test keyring the configured one. Undo with vi.unstubAllEnvs(). */
export function stubTestCredentialKeyring(): void {
  vi.stubEnv(CURRENT_ENV, TEST_KID);
  vi.stubEnv(TEST_KEY_ENV, TEST_KEY_B64URL);
}

/** Simulates a missing keyring. Undo with vi.unstubAllEnvs(). */
export function stubMissingCredentialKeyring(): void {
  vi.stubEnv(CURRENT_ENV, "");
  vi.stubEnv(TEST_KEY_ENV, "");
}

/**
 * The `key` and `encryptedKey` a credential row holds in production for this token object, encrypted with the
 * test keyring and bound to the row's type, userId and teamId. Spread it into a fixture.
 */
export function encryptedTestCredentialFields({
  type,
  userId,
  teamId,
  key,
}: {
  type: string;
  userId?: number | null;
  teamId?: number | null;
  key: object;
}): { key: { _enc: "keyring-v1" }; encryptedKey: string } {
  return withTestKeyring(() => {
    const envelope = encryptSecret({
      ring: "CREDENTIALS",
      plaintext: JSON.stringify(key),
      aad: credentialKeyAad({ type, userId, teamId }),
    });
    return { key: encryptedKeyPlaceholder(), encryptedKey: JSON.stringify(envelope) };
  });
}

/** Decrypts a row's `encryptedKey` with the test keyring. Throws when it is missing or doesn't decrypt. */
export function decryptTestCredentialKey(row: {
  type: string;
  userId?: number | null;
  teamId?: number | null;
  encryptedKey: string | null;
}): Prisma.JsonObject {
  const { encryptedKey } = row;
  if (!encryptedKey) throw new Error("credential row has no encryptedKey");
  return withTestKeyring(
    () =>
      JSON.parse(
        decryptSecret({ envelope: parseSecretEnvelope(encryptedKey), aad: credentialKeyAad(row) })
      ) as Prisma.JsonObject
  );
}
