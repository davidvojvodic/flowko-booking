import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { webhookRouter } from "./_router";
import { ensureWebhookAccess } from "./util";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  listHandler: vi.fn(),
  getHandler: vi.fn(),
  createHandler: vi.fn(),
  editHandler: vi.fn(),
  deleteHandler: vi.fn(),
  testTriggerHandler: vi.fn(),
  getByViewerHandler: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("./list.handler", () => ({ listHandler: mocks.listHandler }));
vi.mock("./get.handler", () => ({ getHandler: mocks.getHandler }));
vi.mock("./create.handler", () => ({ createHandler: mocks.createHandler }));
vi.mock("./edit.handler", () => ({ editHandler: mocks.editHandler }));
vi.mock("./delete.handler", () => ({ deleteHandler: mocks.deleteHandler }));
vi.mock("./testTrigger.handler", () => ({ testTriggerHandler: mocks.testTriggerHandler }));
vi.mock("./getByViewer.handler", () => ({ getByViewerHandler: mocks.getByViewerHandler }));

const createCaller = createCallerFactory(webhookRouter);

type Caller = ReturnType<typeof createCaller>;

// validateRole demotes an ADMIN without 2FA or a strong password to INACTIVE_ADMIN only in the JWT, never in
// the database. NO_2FA: 2FA off in the database. WEAK_PASSWORD: 2FA on, but the JWT says INACTIVE_ADMIN.
function callerFor(role: "USER" | "ADMIN" | "NO_2FA" | "WEAK_PASSWORD") {
  const isAdmin = role !== "USER";
  const user = {
    id: isAdmin ? 9 : 1,
    role: isAdmin ? "ADMIN" : role,
    username: isAdmin ? "flowko" : "salon",
    twoFactorEnabled: role !== "NO_2FA",
    identityProvider: "CAL",
  };
  mocks.getUserSession.mockResolvedValue({
    user,
    session: { user: { id: user.id }, upId: `usr-${user.id}` },
  });
  mocks.getToken.mockResolvedValue({ role: role === "ADMIN" ? "ADMIN" : isAdmin ? "INACTIVE_ADMIN" : role });
  return createCaller({ req: {} } as Parameters<typeof createCaller>[0]);
}

const handlers = [
  mocks.listHandler,
  mocks.getHandler,
  mocks.createHandler,
  mocks.editHandler,
  mocks.deleteHandler,
  mocks.testTriggerHandler,
  mocks.getByViewerHandler,
];

// Every procedure of the webhook router, with an input its own schema accepts
const calls: [string, (caller: Caller) => Promise<unknown>][] = [
  ["list", (caller) => caller.list()],
  ["get", (caller) => caller.get({ webhookId: "webhook-1" })],
  [
    "create",
    (caller) =>
      caller.create({
        subscriberUrl: "https://example.com/hook",
        eventTriggers: ["BOOKING_CREATED"],
        active: true,
        payloadTemplate: null,
      }),
  ],
  ["edit", (caller) => caller.edit({ id: "webhook-1", payloadTemplate: null, active: false })],
  ["delete", (caller) => caller.delete({ id: "webhook-1" })],
  ["testTrigger", (caller) => caller.testTrigger({ url: "https://example.com/hook", type: "PING" })],
  ["getByViewer", (caller) => caller.getByViewer()],
];

describe("webhookRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const handler of handlers) handler.mockResolvedValue("handled");
  });

  // A webhook sends full booker data to any URL, and client businesses have no use for one
  it.each(calls)("refuses %s to a user who isn't an admin", async (_name, call) => {
    await expect(call(callerFor("USER"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    for (const handler of handlers) expect(handler).not.toHaveBeenCalled();
    expect(prismaMock.webhook.findUnique).not.toHaveBeenCalled();
  });

  it.each(calls)("refuses %s to an admin with two-factor authentication off", async (_name, call) => {
    await expect(call(callerFor("NO_2FA"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    for (const handler of handlers) expect(handler).not.toHaveBeenCalled();
    expect(prismaMock.webhook.findUnique).not.toHaveBeenCalled();
  });

  it.each(calls)("refuses %s to an admin whose session signed in as INACTIVE_ADMIN", async (_name, call) => {
    await expect(call(callerFor("WEAK_PASSWORD"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    for (const handler of handlers) expect(handler).not.toHaveBeenCalled();
    expect(prismaMock.webhook.findUnique).not.toHaveBeenCalled();
  });

  it("lets an admin list webhooks", async () => {
    await expect(callerFor("ADMIN").list()).resolves.toBe("handled");

    expect(mocks.listHandler).toHaveBeenCalledTimes(1);
  });

  it("still checks that an admin owns the webhook they delete", async () => {
    prismaMock.webhook.findUnique.mockResolvedValue({
      id: "webhook-1",
      userId: 9,
      eventTypeId: null,
    } as never);
    await expect(callerFor("ADMIN").delete({ id: "webhook-1" })).resolves.toBe("handled");

    prismaMock.webhook.findUnique.mockResolvedValue({
      id: "webhook-1",
      userId: 1,
      eventTypeId: null,
    } as never);
    await expect(callerFor("ADMIN").delete({ id: "webhook-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.deleteHandler).toHaveBeenCalledTimes(1);
  });

  // Every procedure that looks up one webhook by id, with an input its own schema accepts
  const byIdCalls: [string, (caller: Caller) => Promise<unknown>, ReturnType<typeof vi.fn>][] = [
    ["get", (caller) => caller.get({ webhookId: "webhook-1" }), mocks.getHandler],
    [
      "edit",
      (caller) => caller.edit({ id: "webhook-1", payloadTemplate: null, active: false }),
      mocks.editHandler,
    ],
    ["delete", (caller) => caller.delete({ id: "webhook-1" }), mocks.deleteHandler],
    [
      "testTrigger",
      (caller) => caller.testTrigger({ id: "webhook-1", url: "https://example.com/hook", type: "PING" }),
      mocks.testTriggerHandler,
    ],
  ];

  // Platform webhooks are stored without a user or event type and receive every tenant's booking events
  it.each(byIdCalls)("lets an admin %s a platform webhook", async (_name, call, handler) => {
    prismaMock.webhook.findUnique.mockResolvedValue({
      id: "webhook-1",
      userId: null,
      eventTypeId: null,
      platform: true,
    } as never);

    await expect(call(callerFor("ADMIN"))).resolves.toBe("handled");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  // A team or app webhook is stored with no user and no event type, so it is nobody's to act on
  it.each(byIdCalls)("refuses %s of a non-platform webhook with no user or event type", async (_, call) => {
    prismaMock.webhook.findUnique.mockResolvedValue({
      id: "webhook-1",
      userId: null,
      eventTypeId: null,
      platform: false,
    } as never);

    await expect(call(callerFor("ADMIN"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    for (const handler of handlers) expect(handler).not.toHaveBeenCalled();
  });

  it.each(byIdCalls)("checks the event type's owner on %s of its webhook", async (_, call, handler) => {
    prismaMock.webhook.findUnique.mockResolvedValue({
      id: "webhook-1",
      userId: null,
      eventTypeId: 5,
      platform: false,
    } as never);

    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 9 } as never);
    await expect(call(callerFor("ADMIN"))).resolves.toBe("handled");

    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 1 } as never);
    await expect(call(callerFor("ADMIN"))).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("refuses an event type other than the webhook's own", async () => {
    prismaMock.webhook.findUnique.mockResolvedValue({
      id: "webhook-1",
      userId: 9,
      eventTypeId: null,
      platform: false,
    } as never);

    await expect(callerFor("ADMIN").delete({ id: "webhook-1", eventTypeId: 5 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    expect(mocks.deleteHandler).not.toHaveBeenCalled();
    expect(prismaMock.eventType.findUnique).not.toHaveBeenCalled();
  });
});

// The ownership check on its own, for a caller who is not an instance admin: it has to hold even if the
// admin-only rule in front of it ever changes
describe("ensureWebhookAccess", () => {
  const tenant = { userId: 1, isInstanceAdmin: false };

  function storedWebhook(webhook: { userId: number | null; eventTypeId: number | null; platform: boolean }) {
    prismaMock.webhook.findUnique.mockResolvedValue({ id: "webhook-1", ...webhook } as never);
  }

  it("refuses a platform webhook to a user who isn't an instance admin", async () => {
    storedWebhook({ userId: null, eventTypeId: null, platform: true });

    await expect(ensureWebhookAccess({ ...tenant, input: { id: "webhook-1" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const byWebhookId = ensureWebhookAccess({ ...tenant, input: { webhookId: "webhook-1" } });
    await expect(byWebhookId).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a platform webhook even when it names an event type the user owns", async () => {
    storedWebhook({ userId: null, eventTypeId: 5, platform: true });
    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 1 } as never);

    await expect(
      ensureWebhookAccess({ ...tenant, input: { id: "webhook-1", eventTypeId: 5 } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an instance admin act on a platform webhook", async () => {
    storedWebhook({ userId: null, eventTypeId: null, platform: true });

    await expect(
      ensureWebhookAccess({ userId: 9, isInstanceAdmin: true, input: { id: "webhook-1" } })
    ).resolves.toBeUndefined();
  });

  it("refuses a webhook with no user and no event type", async () => {
    storedWebhook({ userId: null, eventTypeId: null, platform: false });

    await expect(ensureWebhookAccess({ ...tenant, input: { id: "webhook-1" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses another user's webhook and lets the owner act on their own", async () => {
    storedWebhook({ userId: 2, eventTypeId: null, platform: false });
    await expect(ensureWebhookAccess({ ...tenant, input: { id: "webhook-1" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    storedWebhook({ userId: 1, eventTypeId: null, platform: false });
    await expect(ensureWebhookAccess({ ...tenant, input: { id: "webhook-1" } })).resolves.toBeUndefined();
  });

  it("checks the event type's owner for an event-type webhook", async () => {
    storedWebhook({ userId: null, eventTypeId: 5, platform: false });

    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 2 } as never);
    await expect(ensureWebhookAccess({ ...tenant, input: { id: "webhook-1" } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 1 } as never);
    await expect(
      ensureWebhookAccess({ ...tenant, input: { id: "webhook-1", eventTypeId: 5 } })
    ).resolves.toBeUndefined();
  });

  it("refuses an event type other than the webhook's own", async () => {
    storedWebhook({ userId: 1, eventTypeId: null, platform: false });

    await expect(
      ensureWebhookAccess({ ...tenant, input: { id: "webhook-1", eventTypeId: 5 } })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses an unknown webhook", async () => {
    prismaMock.webhook.findUnique.mockResolvedValue(null);

    await expect(ensureWebhookAccess({ ...tenant, input: { id: "webhook-1" } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("checks the owner of an event type given without a webhook", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 2 } as never);
    await expect(ensureWebhookAccess({ ...tenant, input: { eventTypeId: 5 } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    prismaMock.eventType.findUnique.mockResolvedValue({ id: 5, userId: 1 } as never);
    await expect(ensureWebhookAccess({ ...tenant, input: { eventTypeId: 5 } })).resolves.toBeUndefined();
    expect(prismaMock.webhook.findUnique).not.toHaveBeenCalled();
  });
});
