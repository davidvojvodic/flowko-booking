// Flowko U29c: viewer.flowko.workers.* API handlers + strict input shapes (W11). The services are mocked (workers.ts
// and lock.ts have their own unit and Postgres tests); this file pins what the API layer adds: the actor is always
// ctx.user.id, `now` is taken once per call in the handler, the flowkoSettings:<id> bucket runs before the service on
// all five procedures, the error mapping (forbidden → FORBIDDEN; the member codes → BAD_REQUEST with the code) and
// the exact input shapes.
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listWorkers: vi.fn(),
  addDeskWorker: vi.fn(),
  reorderWorkers: vi.fn(),
  lockMember: vi.fn(),
  unlockMember: vi.fn(),
  disconnectGoogleOfUser: vi.fn(),
  checkRateLimitAndThrowError: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("@calcom/prisma", () => ({ prisma: m.prisma, default: m.prisma }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: m.checkRateLimitAndThrowError,
}));
vi.mock("@calcom/features/flowkoBusiness/workers", () => ({
  listWorkers: m.listWorkers,
  addDeskWorker: m.addDeskWorker,
  reorderWorkers: m.reorderWorkers,
}));
vi.mock("@calcom/features/flowkoBusiness/lock", () => ({
  lockMember: m.lockMember,
  unlockMember: m.unlockMember,
}));
vi.mock("@calcom/features/flowkoBusiness/disconnectGoogle", () => ({
  disconnectGoogleOfUser: m.disconnectGoogleOfUser,
}));

import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";

import * as handlers from "./workers.handler";
import * as schemas from "./workers.schema";

const ctx = { user: { id: 7 } } as never;

type Case = {
  name: string;
  service: ReturnType<typeof vi.fn>;
  run: () => Promise<unknown>;
  args: unknown[];
};

const cases: Case[] = [
  {
    name: "list",
    service: m.listWorkers,
    run: () => handlers.listHandler({ ctx }),
    args: [m.prisma, 7, expect.any(Date)],
  },
  {
    name: "lock",
    service: m.lockMember,
    run: () => handlers.lockHandler({ ctx, input: { memberId: 12 } }),
    args: [{ db: m.prisma, disconnectGoogle: expect.any(Function) }, 7, 12, expect.any(Date)],
  },
  {
    name: "unlock",
    service: m.unlockMember,
    run: () => handlers.unlockHandler({ ctx, input: { memberId: 12 } }),
    args: [m.prisma, 7, 12, expect.any(Date)],
  },
  {
    name: "addDeskOnly",
    service: m.addDeskWorker,
    run: () => handlers.addDeskOnlyHandler({ ctx, input: { displayName: "Ana" } }),
    args: [m.prisma, 7, { displayName: "Ana" }],
  },
  {
    name: "reorder",
    service: m.reorderWorkers,
    run: () => handlers.reorderHandler({ ctx, input: { memberIds: [13, 12] } }),
    args: [m.prisma, 7, { memberIds: [13, 12] }],
  },
];

describe("viewer.flowko.workers handlers (Flowko U29c)", () => {
  beforeEach(() => {
    for (const c of cases) c.service.mockReset();
    m.disconnectGoogleOfUser.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it.each(cases)("$name calls its service with the session user id, never one from the input", async (c) => {
    c.service.mockResolvedValue("result");
    await expect(c.run()).resolves.toBe("result");
    expect(c.service).toHaveBeenCalledTimes(1);
    expect(c.service.mock.calls[0]).toEqual(c.args);
  });

  it("lock passes the global client and a disconnect that runs disconnectGoogleOfUser for the user id", async () => {
    m.lockMember.mockResolvedValue("result");
    m.disconnectGoogleOfUser.mockResolvedValue("disconnected");
    await handlers.lockHandler({ ctx, input: { memberId: 12 } });
    const deps = m.lockMember.mock.calls[0][0];
    expect(deps.db).toBe(m.prisma);
    await expect(deps.disconnectGoogle(55)).resolves.toBe("disconnected");
    expect(m.disconnectGoogleOfUser).toHaveBeenCalledWith(55);
  });

  it.each(cases)("$name rate limits as flowkoSettings:<id>, before the service", async (c) => {
    c.service.mockResolvedValue(undefined);
    await c.run();
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledTimes(1);
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledWith({
      identifier: "flowkoSettings:7",
      rateLimitingType: "common",
    });
    expect(m.checkRateLimitAndThrowError.mock.invocationCallOrder[0]).toBeLessThan(
      c.service.mock.invocationCallOrder[0]
    );
  });

  it.each(cases)("$name: a rate-limit refusal stops it before the service runs", async (c) => {
    const limited = new Error("429");
    m.checkRateLimitAndThrowError.mockRejectedValue(limited);
    await expect(c.run()).rejects.toBe(limited);
    expect(c.service).not.toHaveBeenCalled();
  });

  // A WORKER, a STAFF, a non-member and another business's owner all get forbidden from the service.
  it.each(cases)("$name maps forbidden to TRPCError FORBIDDEN", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });

  it.each(cases)("$name rethrows a non-Flowko error unchanged", async (c) => {
    const boom = new Error("db down");
    c.service.mockRejectedValue(boom);
    await expect(c.run()).rejects.toBe(boom);
  });

  it.each([
    ["unlock", "member_not_locked", () => handlers.unlockHandler({ ctx, input: { memberId: 12 } }), m.unlockMember],
    ["lock", "owner_cannot_be_locked", () => handlers.lockHandler({ ctx, input: { memberId: 12 } }), m.lockMember],
    ["lock", "member_conflict", () => handlers.lockHandler({ ctx, input: { memberId: 12 } }), m.lockMember],
    [
      "addDeskOnly",
      "member_name_taken",
      () => handlers.addDeskOnlyHandler({ ctx, input: { displayName: "Ana" } }),
      m.addDeskWorker,
    ],
    [
      "addDeskOnly",
      "member_conflict",
      () => handlers.addDeskOnlyHandler({ ctx, input: { displayName: "Ana" } }),
      m.addDeskWorker,
    ],
    ["reorder", "bad_member", () => handlers.reorderHandler({ ctx, input: { memberIds: [12, 999] } }), m.reorderWorkers],
    ["reorder", "member_conflict", () => handlers.reorderHandler({ ctx, input: { memberIds: [12] } }), m.reorderWorkers],
  ] as const)("%s maps %s to BAD_REQUEST with the code as message", async (_name, code, run, service) => {
    service.mockRejectedValue(new FlowkoBusinessError(code));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(code);
  });

  it("list and lock take `now` once per call, as a fresh Date", async () => {
    m.listWorkers.mockResolvedValue({ members: [] });
    const before = Date.now();
    await handlers.listHandler({ ctx });
    const now = m.listWorkers.mock.calls[0][2] as Date;
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("viewer.flowko.workers input schemas (Flowko U29c, strict)", () => {
  const MAX_INT4 = 2147483647;

  it("accept the Delavci page's inputs", () => {
    expect(schemas.ZLockMemberInput.safeParse({ memberId: 1 }).success).toBe(true);
    expect(schemas.ZUnlockMemberInput.safeParse({ memberId: MAX_INT4 }).success).toBe(true);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "Ana" }).success).toBe(true);
    expect(schemas.ZReorderWorkersInput.safeParse({ memberIds: [3, 1, 2] }).success).toBe(true);
  });

  it("refuse unknown keys (no actor, business or user id from the client)", () => {
    expect(schemas.ZLockMemberInput.safeParse({ memberId: 1, userId: 5 }).success).toBe(false);
    expect(schemas.ZUnlockMemberInput.safeParse({ memberId: 1, force: true }).success).toBe(false);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "Ana", email: "a@b.si" }).success).toBe(false);
    expect(schemas.ZReorderWorkersInput.safeParse({ memberIds: [1], businessId: 5 }).success).toBe(false);
  });

  it("ids are integers 1..2147483647", () => {
    for (const bad of [0, -1, 1.5, MAX_INT4 + 1, "1"]) {
      expect(schemas.ZLockMemberInput.safeParse({ memberId: bad }).success).toBe(false);
      expect(schemas.ZUnlockMemberInput.safeParse({ memberId: bad }).success).toBe(false);
      expect(schemas.ZReorderWorkersInput.safeParse({ memberIds: [1, bad] }).success).toBe(false);
    }
  });

  it("a missing field is refused", () => {
    expect(schemas.ZLockMemberInput.safeParse({}).success).toBe(false);
    expect(schemas.ZUnlockMemberInput.safeParse({}).success).toBe(false);
    expect(schemas.ZAddDeskOnlyInput.safeParse({}).success).toBe(false);
    expect(schemas.ZReorderWorkersInput.safeParse({}).success).toBe(false);
  });

  it("an empty reorder list and 501 ids are refused; 500 pass", () => {
    expect(schemas.ZReorderWorkersInput.safeParse({ memberIds: [] }).success).toBe(false);
    expect(
      schemas.ZReorderWorkersInput.safeParse({ memberIds: Array.from({ length: 500 }, (_, i) => i + 1) }).success
    ).toBe(true);
    expect(
      schemas.ZReorderWorkersInput.safeParse({ memberIds: Array.from({ length: 501 }, (_, i) => i + 1) }).success
    ).toBe(false);
  });

  it("displayName is capped at 200 early; the trim and the 80-character rule are the service's", () => {
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "n".repeat(200) }).success).toBe(true);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "n".repeat(201) }).success).toBe(false);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "" }).success).toBe(true);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: 5 }).success).toBe(false);
  });
});
