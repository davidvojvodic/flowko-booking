import prismock from "@calcom/testing/lib/__mocks__/prisma";

import type { Prisma } from "@calcom/prisma/client";
import { encryptedTestCredentialFields } from "@calcom/testing/lib/credentialKeyring";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrpcSessionUser } from "../../../types";
import { updateAppCredentialsHandler } from "./updateAppCredentials.handler";

// The PayPal validator calls PayPal (test credentials, delete and create webhooks); it must never run for a
// refused credential
const { mockPaypalValidator } = vi.hoisted(() => ({ mockPaypalValidator: vi.fn() }));
vi.mock("@calcom/paypal/lib/updateAppCredentials.validator", () => ({ default: mockPaypalValidator }));

const USER_ID = 1;
const OTHER_USER_ID = 2;
const user = { id: USER_ID } as unknown as NonNullable<TrpcSessionUser>;

const GOOGLE_TOKEN = {
  access_token: "ya29.test-access-token",
  refresh_token: "1//test-refresh-token",
  scope: "https://www.googleapis.com/auth/calendar.events",
  token_type: "Bearer",
  expiry_date: 1_900_000_000_000,
};

const seedCredential = async (data: {
  id: number;
  type: string;
  appId: string | null;
  key: Prisma.InputJsonObject;
  encryptedKey?: string | null;
  userId?: number;
}) =>
  prismock.credential.create({
    data: { userId: USER_ID, encryptedKey: null, ...data },
  });

const storedRow = (id: number) =>
  prismock.credential.findUniqueOrThrow({ where: { id }, select: { key: true, encryptedKey: true } });

const update = (credentialId: number, key: Record<string, unknown>) =>
  updateAppCredentialsHandler({ ctx: { user }, input: { credentialId, key } });

describe("updateAppCredentialsHandler: Flowko U9 key-merge guard", () => {
  beforeEach(() => {
    mockPaypalValidator.mockReset();
  });

  it("refuses an encrypted google_calendar credential and leaves the row unchanged", async () => {
    const encrypted = encryptedTestCredentialFields({
      type: "google_calendar",
      userId: USER_ID,
      teamId: null,
      key: GOOGLE_TOKEN,
    });
    await seedCredential({ id: 10, type: "google_calendar", appId: "google-calendar", ...encrypted });

    await expect(update(10, { access_token: "attacker-chosen" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Credential 10 can't be updated here",
    });

    expect(await storedRow(10)).toEqual({ key: { _enc: "keyring-v1" }, encryptedKey: encrypted.encryptedKey });
  });

  it("refuses a legacy google_calendar row without an envelope, so its plaintext key is never merged or rewritten", async () => {
    await seedCredential({ id: 11, type: "google_calendar", appId: "google-calendar", key: GOOGLE_TOKEN });

    const error = await update(11, { refresh_token: "attacker-chosen" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "FORBIDDEN", message: "Credential 11 can't be updated here" });

    expect(await storedRow(11)).toEqual({ key: GOOGLE_TOKEN, encryptedKey: null });
  });

  it("refuses a credential with no appId", async () => {
    await seedCredential({ id: 12, type: "some_app", appId: null, key: { a: 1 } });

    await expect(update(12, { a: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await storedRow(12)).toEqual({ key: { a: 1 }, encryptedKey: null });
  });

  it.each([
    [
      "an envelope",
      encryptedTestCredentialFields({
        type: "paypal_payment",
        userId: USER_ID,
        teamId: null,
        key: { client_id: "stored-id", secret_key: "stored-secret" },
      }).encryptedKey,
    ],
    ["an empty string", ""],
  ])(
    "refuses an allow-listed app's credential whose encryptedKey is %s, before its validator runs",
    async (_label, encryptedKey) => {
      await seedCredential({
        id: 13,
        type: "paypal_payment",
        appId: "paypal",
        key: { _enc: "keyring-v1" },
        encryptedKey,
      });

      await expect(update(13, { client_id: "id", secret_key: "secret" })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Credential 13 can't be updated here",
      });

      expect(mockPaypalValidator).not.toHaveBeenCalled();
      expect(await storedRow(13)).toEqual({ key: { _enc: "keyring-v1" }, encryptedKey });
    }
  );

  it("still merges the validated keys into a PayPal credential", async () => {
    mockPaypalValidator.mockResolvedValue({ client_id: "new-id", secret_key: "new-secret", webhook_id: "wh_1" });
    await seedCredential({
      id: 20,
      type: "paypal_payment",
      appId: "paypal",
      key: { client_id: "old-id", secret_key: "old-secret", currency: "EUR" },
    });

    await expect(update(20, { client_id: "new-id", secret_key: "new-secret" })).resolves.toBe(true);

    expect(mockPaypalValidator).toHaveBeenCalledTimes(1);
    expect(await storedRow(20)).toEqual({
      key: { client_id: "new-id", secret_key: "new-secret", webhook_id: "wh_1", currency: "EUR" },
      encryptedKey: null,
    });
  });

  it.each([
    ["alby", "alby_payment"],
    ["hitpay", "hitpay_payment"],
    ["btcpayserver", "btcpayserver_payment"],
  ])("still merges the keys of a %s credential", async (appId, type) => {
    await seedCredential({ id: 21, type, appId, key: { kept: "yes", replaced: "old" } });

    await expect(update(21, { replaced: "new" })).resolves.toBe(true);

    expect(mockPaypalValidator).not.toHaveBeenCalled();
    expect(await storedRow(21)).toEqual({ key: { kept: "yes", replaced: "new" }, encryptedKey: null });
  });

  it("still answers BAD_REQUEST for another user's credential and leaves it unchanged", async () => {
    await seedCredential({
      id: 30,
      type: "paypal_payment",
      appId: "paypal",
      key: { client_id: "theirs" },
      userId: OTHER_USER_ID,
    });

    await expect(update(30, { client_id: "mine" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Could not find credential 30",
    });

    expect(mockPaypalValidator).not.toHaveBeenCalled();
    expect(await storedRow(30)).toEqual({ key: { client_id: "theirs" }, encryptedKey: null });
  });
});
