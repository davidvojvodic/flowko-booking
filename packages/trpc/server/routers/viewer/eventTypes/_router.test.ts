import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { eventTypesRouter } from "./_router";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  getHandler: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("./get.handler", () => ({ getHandler: mocks.getHandler }));

const createCaller = createCallerFactory(eventTypesRouter);

const ATTACKER_ID = 1;
const VICTIM_ID = 2;
const OWN_EVENT_TYPE_ID = 10;
const VICTIM_EVENT_TYPE_ID = 20;

const eventTypes: Record<number, { id: number; userId: number; teamId: null; users: { id: number }[] }> = {
  [OWN_EVENT_TYPE_ID]: { id: OWN_EVENT_TYPE_ID, userId: ATTACKER_ID, teamId: null, users: [{ id: ATTACKER_ID }] },
  [VICTIM_EVENT_TYPE_ID]: {
    id: VICTIM_EVENT_TYPE_ID,
    userId: VICTIM_ID,
    teamId: null,
    users: [{ id: VICTIM_ID }],
  },
};

function callerFor(userId: number) {
  mocks.getUserSession.mockResolvedValue({
    user: { id: userId, role: "USER", username: `tenant-${userId}` },
    session: { user: { id: userId }, upId: `usr-${userId}` },
  });
  return createCaller({ prisma: prismaMock } as unknown as Parameters<typeof createCaller>[0]);
}

describe("eventTypesRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.eventType.findUnique.mockImplementation((({ where }: { where: { id: number } }) =>
      Promise.resolve(eventTypes[where.id] ?? null)) as never);
    prismaMock.eventType.delete.mockImplementation((({ where }: { where: { id: number } }) =>
      Promise.resolve({ id: where.id })) as never);
    prismaMock.eventTypeCustomInput.deleteMany.mockResolvedValue({ count: 0 });
    mocks.getHandler.mockResolvedValue("handled");
  });

  describe("delete", () => {
    it("deletes the caller's own event type", async () => {
      await expect(callerFor(ATTACKER_ID).delete({ id: OWN_EVENT_TYPE_ID })).resolves.toEqual({
        id: OWN_EVENT_TYPE_ID,
      });

      expect(prismaMock.eventType.delete).toHaveBeenCalledWith({ where: { id: OWN_EVENT_TYPE_ID } });
    });

    // ET-1: the middleware authorized eventTypeId and the handler deleted id
    it("refuses {id: victim, eventTypeId: own} and deletes nothing", async () => {
      await expect(
        callerFor(ATTACKER_ID).delete({
          id: VICTIM_EVENT_TYPE_ID,
          eventTypeId: OWN_EVENT_TYPE_ID,
        } as unknown as { id: number })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(prismaMock.eventTypeCustomInput.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
    });

    // Every caller sends only id, so the delete schema is strict
    it("refuses a key besides id even when it names the same event type", async () => {
      await expect(
        callerFor(ATTACKER_ID).delete({
          id: OWN_EVENT_TYPE_ID,
          eventTypeId: OWN_EVENT_TYPE_ID,
        } as unknown as { id: number })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
    });

    it("refuses another tenant's event type and deletes nothing", async () => {
      await expect(callerFor(ATTACKER_ID).delete({ id: VICTIM_EVENT_TYPE_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(prismaMock.eventTypeCustomInput.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("reads the caller's own event type", async () => {
      await expect(callerFor(ATTACKER_ID).get({ id: OWN_EVENT_TYPE_ID })).resolves.toBe("handled");

      expect(mocks.getHandler).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ id: OWN_EVENT_TYPE_ID }) })
      );
    });

    // The middleware authorized eventTypeId and the handler read id
    it("refuses {id: victim, eventTypeId: own}", async () => {
      await expect(
        callerFor(ATTACKER_ID).get({
          id: VICTIM_EVENT_TYPE_ID,
          eventTypeId: OWN_EVENT_TYPE_ID,
        } as unknown as { id: number })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mocks.getHandler).not.toHaveBeenCalled();
    });

    // Every caller sends only id, so the get schema is strict
    it("refuses a key besides id even when it names the same event type", async () => {
      await expect(
        callerFor(ATTACKER_ID).get({
          id: OWN_EVENT_TYPE_ID,
          eventTypeId: OWN_EVENT_TYPE_ID,
        } as unknown as { id: number })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mocks.getHandler).not.toHaveBeenCalled();
    });
  });
});
