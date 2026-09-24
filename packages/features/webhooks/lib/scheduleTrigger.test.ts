import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { describe, expect, it, vi } from "vitest";

import type { ApiKey } from "@calcom/prisma/client";
import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import { addSubscription, deleteSubscription } from "./scheduleTrigger";

vi.mock("@calcom/features/tasker", () => ({ default: { create: vi.fn() } }));

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
});
