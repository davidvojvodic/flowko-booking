import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it } from "vitest";

import { MembershipRole } from "@calcom/prisma/enums";

import type { TrpcSessionUser } from "../../../types";
import { deleteHandler } from "./delete.handler";

const OWNER_ID = 1;
const OTHER_TENANT_ID = 2;

const ctxFor = (userId: number) => ({ ctx: { user: { id: userId } as NonNullable<TrpcSessionUser> } });

describe("deleteHandler", () => {
  beforeEach(() => {
    prismaMock.eventType.delete.mockResolvedValue({ id: 10 } as never);
    prismaMock.eventTypeCustomInput.deleteMany.mockResolvedValue({ count: 0 });
  });

  it("deletes the caller's own personal event type", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue({
      userId: OWNER_ID,
      teamId: null,
      users: [{ id: OWNER_ID }],
    } as never);

    await expect(deleteHandler({ ...ctxFor(OWNER_ID), input: { id: 10 } })).resolves.toEqual({ id: 10 });

    expect(prismaMock.eventType.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10 } })
    );
    expect(prismaMock.eventTypeCustomInput.deleteMany).toHaveBeenCalledWith({ where: { eventTypeId: 10 } });
    expect(prismaMock.eventType.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it("deletes a personal event type the caller is assigned to", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue({
      userId: null,
      teamId: null,
      users: [{ id: OWNER_ID }],
    } as never);

    await expect(deleteHandler({ ...ctxFor(OWNER_ID), input: { id: 10 } })).resolves.toEqual({ id: 10 });

    expect(prismaMock.eventType.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  // ET-1: the handler deletes input.id, so it has to authorize input.id itself
  it("refuses another tenant's event type and deletes nothing", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue({
      userId: OTHER_TENANT_ID,
      teamId: null,
      users: [{ id: OTHER_TENANT_ID }],
    } as never);

    await expect(deleteHandler({ ...ctxFor(OWNER_ID), input: { id: 20 } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(prismaMock.eventTypeCustomInput.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for an event type that does not exist and deletes nothing", async () => {
    prismaMock.eventType.findUnique.mockResolvedValue(null);

    await expect(deleteHandler({ ...ctxFor(OWNER_ID), input: { id: 999 } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(prismaMock.eventTypeCustomInput.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
  });

  describe("team event type", () => {
    const teamEvent = { userId: OWNER_ID, teamId: 5, users: [{ id: OWNER_ID }] };

    it("refuses it when the caller holds no admin or owner membership of the team", async () => {
      prismaMock.eventType.findUnique.mockResolvedValue(teamEvent as never);
      prismaMock.membership.findFirst.mockResolvedValue(null);

      await expect(deleteHandler({ ...ctxFor(OWNER_ID), input: { id: 30 } })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(prismaMock.membership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teamId: 5,
            userId: OWNER_ID,
            accepted: true,
            role: { in: [MembershipRole.ADMIN, MembershipRole.OWNER] },
          },
        })
      );
      expect(prismaMock.eventTypeCustomInput.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
    });

    it("deletes it for an admin or owner of the team", async () => {
      prismaMock.eventType.findUnique.mockResolvedValue(teamEvent as never);
      prismaMock.membership.findFirst.mockResolvedValue({ id: 1 } as never);

      await expect(deleteHandler({ ...ctxFor(OWNER_ID), input: { id: 30 } })).resolves.toEqual({ id: 30 });

      expect(prismaMock.eventType.delete).toHaveBeenCalledWith({ where: { id: 30 } });
    });
  });
});
