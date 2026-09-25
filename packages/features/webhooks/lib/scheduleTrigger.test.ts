import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKey } from "@calcom/prisma/client";
import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import { addSubscription, deleteSubscription } from "./scheduleTrigger";

vi.mock("@calcom/features/tasker", () => ({ default: { create: vi.fn() } }));

// Flowko (WH-2): the subscriber URL is checked (with DNS) before it is stored. booking.flowko.si is
// self-hosted (IS_SELF_HOSTED is true).
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  IS_SELF_HOSTED: true,
}));

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockImplementation(async (hostname: string) =>
    hostname === "metadata.attacker.example"
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.215.14", family: 4 }]
  );
});

const apiKey = (userId: number, teamId: number | null = null) =>
  ({ id: "key-1", userId, teamId, appId: "zapier" }) as ApiKey;

// An admin who meets the admin security requirements (validateRole): 2FA on
const activeAdmin = { role: "ADMIN", twoFactorEnabled: true, identityProvider: "CAL" };

const subscription = {
  triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
  subscriberUrl: "https://hooks.example.com/catch",
  appId: "zapier",
};

// A Zapier or Make subscription is a webhook, which sends full booker data to its URL
describe("Zapier and Make subscriptions", () => {
  it("refuses to create one for a key of a user who isn't an admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "USER" } as never);

    await expect(addSubscription({ appApiKey: apiKey(1), ...subscription })).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { role: true, twoFactorEnabled: true, identityProvider: true },
    });
    expect(prismaMock.webhook.create).not.toHaveBeenCalled();
  });

  it("refuses to create one for an OAuth account of a user who isn't an admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "USER" } as never);

    await expect(
      addSubscription({ account: { id: 1, name: "Salon", isTeam: false }, ...subscription })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prismaMock.webhook.create).not.toHaveBeenCalled();
  });

  it("refuses to create one for a team key", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeAdmin as never);

    await expect(addSubscription({ appApiKey: apiKey(9, 3), ...subscription })).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(prismaMock.webhook.create).not.toHaveBeenCalled();
  });

  // validateRole makes this admin an INACTIVE_ADMIN at sign-in, but the database still says ADMIN
  it("refuses to create one for a key of an admin with two-factor authentication off", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeAdmin, twoFactorEnabled: false } as never);

    await expect(addSubscription({ appApiKey: apiKey(9), ...subscription })).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(prismaMock.webhook.create).not.toHaveBeenCalled();
  });

  it("refuses to delete one for a key of an admin with two-factor authentication off", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeAdmin, twoFactorEnabled: false } as never);

    await expect(
      deleteSubscription({ appApiKey: apiKey(9), webhookId: "webhook-1", appId: "zapier" })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prismaMock.webhook.delete).not.toHaveBeenCalled();
  });

  it("creates one for an admin's key", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeAdmin as never);
    prismaMock.webhook.create.mockResolvedValue({ id: "webhook-1" } as never);

    await expect(addSubscription({ appApiKey: apiKey(9), ...subscription })).resolves.toEqual({
      id: "webhook-1",
    });

    expect(prismaMock.webhook.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 9, teamId: null, subscriberUrl: subscription.subscriberUrl }),
    });
  });

  it("refuses to delete one for a key of a user who isn't an admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "USER" } as never);

    await expect(
      deleteSubscription({ appApiKey: apiKey(1), webhookId: "webhook-1", appId: "zapier" })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prismaMock.webhook.delete).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:3000/api/auth/setup",
    "https://localhost/",
    "https://10.0.0.1/",
    "https://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "https://metadata.attacker.example/latest/meta-data/",
    "http://hooks.example.com/catch",
  ])("refuses to create one for an admin's key with the URL %s", async (subscriberUrl) => {
    prismaMock.user.findUnique.mockResolvedValue(activeAdmin as never);

    await expect(
      addSubscription({ appApiKey: apiKey(9), ...subscription, subscriberUrl })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/^Webhook URL is not allowed: /),
    });

    expect(prismaMock.webhook.create).not.toHaveBeenCalled();
  });

  it("checks the admin before the URL, so a non-admin's key triggers no DNS lookup", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: "USER" } as never);

    await expect(
      addSubscription({
        appApiKey: apiKey(1),
        ...subscription,
        subscriberUrl: "https://internal.attacker.example/",
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("the URL refusal names no URL (U7b keeps webhook URLs out of logs)", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeAdmin as never);

    await expect(
      addSubscription({
        appApiKey: apiKey(9),
        ...subscription,
        subscriberUrl: "https://metadata.attacker.example/latest/meta-data/",
      })
    ).rejects.toThrow(/^Webhook URL is not allowed: Hostname resolves to private IP$/);
  });
});
