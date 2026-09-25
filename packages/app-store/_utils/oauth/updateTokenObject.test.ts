import prismock from "@calcom/testing/lib/__mocks__/prisma";
import {
  decryptTestCredentialKey,
  encryptedTestCredentialFields,
  stubMissingCredentialKeyring,
  stubTestCredentialKeyring,
} from "@calcom/testing/lib/credentialKeyring";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialRepository } from "@calcom/features/credentials/repositories/CredentialRepository";
import { CredentialKeyUnavailableError } from "@calcom/features/credentials/services/CredentialDataService";

import { updateTokenObjectInDb } from "./updateTokenObject";

const { updateTokenObjectLogWarn } = vi.hoisted(() => ({ updateTokenObjectLogWarn: vi.fn() }));

vi.mock("@calcom/lib/logger", () => {
  const quiet = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    silly: vi.fn(),
    log: vi.fn(),
  };
  return {
    default: {
      ...quiet,
      getSubLogger: ({ prefix }: { prefix?: string[] }) =>
        prefix?.[2] === "updateTokenObject" ? { ...quiet, warn: updateTokenObjectLogWarn } : quiet,
    },
  };
});

// Flowko U9: the oauth refresh write-back stores the token encrypted, bound to the row's own type, userId and
// teamId, and writes nothing when it can't be encrypted

const STORED_TOKEN = {
  access_token: "STORED_ACCESS_TOKEN",
  refresh_token: "STORED_REFRESH_TOKEN",
  scope: "https://www.googleapis.com/auth/calendar.events",
  token_type: "Bearer",
  expiry_date: 1_700_000_000_000,
};

const REFRESHED_TOKEN = {
  ...STORED_TOKEN,
  access_token: "REFRESHED_ACCESS_TOKEN",
  expiry_date: 1_900_000_000_000,
};

const createRow = ({ type, userId, teamId }: { type: string; userId: number | null; teamId: number | null }) =>
  prismock.credential.create({
    data: {
      type,
      userId,
      teamId,
      invalid: false,
      ...encryptedTestCredentialFields({ type, userId, teamId, key: STORED_TOKEN }),
    },
  });

describe("updateTokenObjectInDb (oauth)", () => {
  beforeEach(() => {
    stubTestCredentialKeyring();
    updateTokenObjectLogWarn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    { name: "a user's google_calendar row", type: "google_calendar", userId: 11, teamId: null },
    { name: "a team's google_calendar row", type: "google_calendar", userId: null, teamId: 7 },
    { name: "a row of another app type", type: "pipedrive-crm", userId: 11, teamId: null },
  ])("encrypts with the row's own type, userId and teamId for $name and returns the envelope", async (fields) => {
    const row = await createRow(fields);

    const result = await updateTokenObjectInDb({
      tokenObject: REFRESHED_TOKEN,
      authStrategy: "oauth",
      credentialId: row.id,
    });

    const stored = await prismock.credential.findUniqueOrThrow({ where: { id: row.id } });
    expect(result).toEqual({ encryptedKey: stored.encryptedKey });
    expect(stored.key).toEqual({ _enc: "keyring-v1" });
    expect(JSON.stringify(stored.key)).not.toMatch(/access_token|refresh_token/);
    expect(stored.encryptedKey).not.toBe(row.encryptedKey);
    expect(decryptTestCredentialKey(stored)).toEqual(REFRESHED_TOKEN);

    // Bound to this row's AAD: the envelope is useless under another owner or app type
    expect(() => decryptTestCredentialKey({ ...stored, userId: (fields.userId ?? 0) + 1 })).toThrow();
    expect(() => decryptTestCredentialKey({ ...stored, teamId: fields.teamId === null ? 7 : null })).toThrow();
    expect(() =>
      decryptTestCredentialKey({
        ...stored,
        type: fields.type === "google_calendar" ? "google_video" : "google_calendar",
      })
    ).toThrow();
  });

  it("writes nothing when the keyring is missing", async () => {
    const row = await createRow({ type: "google_calendar", userId: 11, teamId: null });
    stubMissingCredentialKeyring();

    const error = await updateTokenObjectInDb({
      tokenObject: REFRESHED_TOKEN,
      authStrategy: "oauth",
      credentialId: row.id,
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(CredentialKeyUnavailableError);
    expect(error).toMatchObject({ reason: "keyring_not_configured", credentialType: "google_calendar" });
    expect(await prismock.credential.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("writes nothing when the row's owner changed after it was read", async () => {
    const row = await createRow({ type: "google_calendar", userId: 11, teamId: null });
    vi.spyOn(CredentialRepository, "findKeyAadFieldsById").mockResolvedValueOnce({
      id: row.id,
      type: "google_calendar",
      userId: 12,
      teamId: null,
    });

    await expect(
      updateTokenObjectInDb({ tokenObject: REFRESHED_TOKEN, authStrategy: "oauth", credentialId: row.id })
    ).rejects.toThrow("credential changed; encrypted key not stored");
    expect(await prismock.credential.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("warns and returns undefined when the credential no longer exists", async () => {
    const result = await updateTokenObjectInDb({
      tokenObject: REFRESHED_TOKEN,
      authStrategy: "oauth",
      credentialId: 424242,
    });

    expect(result).toBeUndefined();
    expect(updateTokenObjectLogWarn).toHaveBeenCalledTimes(1);
    expect(updateTokenObjectLogWarn).toHaveBeenCalledWith("Refreshed token not stored: credential not found", {
      credentialId: 424242,
    });
    expect(JSON.stringify(updateTokenObjectLogWarn.mock.calls)).not.toContain("ACCESS_TOKEN");
    expect(await prismock.credential.count()).toBe(0);
  });
});
