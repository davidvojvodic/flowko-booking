import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { webhookRouter } from "./_router";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  listHandler: vi.fn(),
  getHandler: vi.fn(),
  createHandler: vi.fn(),
  editHandler: vi.fn(),
  deleteHandler: vi.fn(),
  testTriggerHandler: vi.fn(),
  getByViewerHandler: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("./list.handler", () => ({ listHandler: mocks.listHandler }));
vi.mock("./get.handler", () => ({ getHandler: mocks.getHandler }));
vi.mock("./create.handler", () => ({ createHandler: mocks.createHandler }));
vi.mock("./edit.handler", () => ({ editHandler: mocks.editHandler }));
vi.mock("./delete.handler", () => ({ deleteHandler: mocks.deleteHandler }));
vi.mock("./testTrigger.handler", () => ({ testTriggerHandler: mocks.testTriggerHandler }));
vi.mock("./getByViewer.handler", () => ({ getByViewerHandler: mocks.getByViewerHandler }));

const createCaller = createCallerFactory(webhookRouter);

type Caller = ReturnType<typeof createCaller>;

function callerFor(role: "USER" | "ADMIN") {
  const user = { id: role === "ADMIN" ? 9 : 1, role, username: role === "ADMIN" ? "flowko" : "salon" };
  mocks.getUserSession.mockResolvedValue({
    user,
    session: { user: { id: user.id }, upId: `usr-${user.id}` },
  });
  return createCaller({} as Parameters<typeof createCaller>[0]);
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
});
