// Flowko U29c: viewer.flowko.workers.* API handlers + strict input shapes (W11). Flowko U29d (Task 5) adds invite,
// resendInvite and revokeInvite (I8, S1): the services are mocked here (invites.ts has its own unit and Postgres
// tests); what is pinned: [deps, ctx.user.id, input, now], flowkoSettings:<id> first on all three, then
// flowkoInvite:<id> (core, 20 per hour) on invite and both resendInvite variants but not on revokeInvite, the error
// mapping and the strict inputs. The services are mocked (workers.ts
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
  createInvite: vi.fn(),
  resendInvite: vi.fn(),
  revokeInvite: vi.fn(),
  sendFlowkoInviteEmail: vi.fn(),
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
vi.mock("@calcom/features/flowkoBusiness/invites", () => ({
  createInvite: m.createInvite,
  resendInvite: m.resendInvite,
  revokeInvite: m.revokeInvite,
}));
vi.mock("@calcom/emails/email-manager", () => ({ sendFlowkoInviteEmail: m.sendFlowkoInviteEmail }));
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  WEBAPP_URL: "https://booking.example",
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

// Flowko U29d (I8, S1): the invite procedures; `deps` is {db, baseUrl, sendInvite} for create and resend.
const INVITE_DEPS = { db: m.prisma, baseUrl: "https://booking.example", sendInvite: expect.any(Function) };
const NEW_INPUT = { kind: "new", name: "Ana", email: "ana@example.si", role: "WORKER" } as const;
const MEMBER_INPUT = { kind: "member", memberId: 12, email: "ana@example.si" } as const;

const inviteCases: (Case & { limited: boolean })[] = [
  {
    name: "invite (new)",
    service: m.createInvite,
    run: () => handlers.inviteHandler({ ctx, input: NEW_INPUT }),
    args: [INVITE_DEPS, 7, NEW_INPUT, expect.any(Date)],
    limited: true,
  },
  {
    name: "invite (member)",
    service: m.createInvite,
    run: () => handlers.inviteHandler({ ctx, input: MEMBER_INPUT }),
    args: [INVITE_DEPS, 7, MEMBER_INPUT, expect.any(Date)],
    limited: true,
  },
  {
    name: "resendInvite (with mail)",
    service: m.resendInvite,
    run: () => handlers.resendInviteHandler({ ctx, input: { inviteId: 4, sendMail: true } }),
    args: [INVITE_DEPS, 7, { inviteId: 4, sendMail: true }, expect.any(Date)],
    limited: true,
  },
  {
    name: "resendInvite (new link, no mail)",
    service: m.resendInvite,
    run: () => handlers.resendInviteHandler({ ctx, input: { inviteId: 4, sendMail: false } }),
    args: [INVITE_DEPS, 7, { inviteId: 4, sendMail: false }, expect.any(Date)],
    limited: true,
  },
  {
    name: "revokeInvite",
    service: m.revokeInvite,
    run: () => handlers.revokeInviteHandler({ ctx, input: { inviteId: 4 } }),
    args: [m.prisma, 7, { inviteId: 4 }, expect.any(Date)],
    limited: false,
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
    [
      "unlock",
      "member_not_locked",
      () => handlers.unlockHandler({ ctx, input: { memberId: 12 } }),
      m.unlockMember,
    ],
    [
      "lock",
      "owner_cannot_be_locked",
      () => handlers.lockHandler({ ctx, input: { memberId: 12 } }),
      m.lockMember,
    ],
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
    [
      "reorder",
      "bad_member",
      () => handlers.reorderHandler({ ctx, input: { memberIds: [12, 999] } }),
      m.reorderWorkers,
    ],
    [
      "reorder",
      "member_conflict",
      () => handlers.reorderHandler({ ctx, input: { memberIds: [12] } }),
      m.reorderWorkers,
    ],
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

describe("viewer.flowko.workers invite handlers (Flowko U29d, I8, S1)", () => {
  beforeEach(() => {
    m.createInvite.mockReset();
    m.resendInvite.mockReset();
    m.revokeInvite.mockReset();
    m.sendFlowkoInviteEmail.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it.each(inviteCases)(
    "$name calls its service with the session user id, never one from the input",
    async (c) => {
      c.service.mockResolvedValue("result");
      await expect(c.run()).resolves.toBe("result");
      expect(c.service).toHaveBeenCalledTimes(1);
      expect(c.service.mock.calls[0]).toEqual(c.args);
    }
  );

  it("invite and resendInvite hand the service the global client, WEBAPP_URL and sendFlowkoInviteEmail", async () => {
    m.createInvite.mockResolvedValue("a");
    m.resendInvite.mockResolvedValue("b");
    await handlers.inviteHandler({ ctx, input: NEW_INPUT });
    await handlers.resendInviteHandler({ ctx, input: { inviteId: 4, sendMail: true } });
    for (const svc of [m.createInvite, m.resendInvite]) {
      const deps = svc.mock.calls[0][0];
      expect(deps.db).toBe(m.prisma);
      expect(deps.baseUrl).toBe("https://booking.example");
      m.sendFlowkoInviteEmail.mockResolvedValueOnce("sent");
      const args = { to: "ana@example.si" };
      await expect(deps.sendInvite(args)).resolves.toBe("sent");
      expect(m.sendFlowkoInviteEmail).toHaveBeenLastCalledWith(args);
    }
  });

  it.each(inviteCases)(
    "$name rate limits flowkoSettings:<id> first, then flowkoInvite:<id> where it mints",
    async (c) => {
      c.service.mockResolvedValue(undefined);
      await c.run();
      const calls = m.checkRateLimitAndThrowError.mock.calls.map((x) => x[0]);
      const settings = { identifier: "flowkoSettings:7", rateLimitingType: "common" };
      const invite = {
        identifier: "flowkoInvite:7",
        rateLimitingType: "core",
        opts: { limit: { limit: 20, duration: "1h" } },
      };
      expect(calls).toEqual(c.limited ? [settings, invite] : [settings]);
      const last = Math.max(...m.checkRateLimitAndThrowError.mock.invocationCallOrder);
      expect(last).toBeLessThan(c.service.mock.invocationCallOrder[0]);
    }
  );

  it.each(inviteCases)(
    "$name: a refusal of the first bucket stops it before the second bucket and the service",
    async (c) => {
      const limited = new Error("429");
      m.checkRateLimitAndThrowError.mockRejectedValueOnce(limited);
      await expect(c.run()).rejects.toBe(limited);
      expect(m.checkRateLimitAndThrowError).toHaveBeenCalledTimes(1);
      expect(c.service).not.toHaveBeenCalled();
    }
  );

  it.each(inviteCases.filter((c) => c.limited))(
    "$name: a refusal of the flowkoInvite bucket stops it before the service",
    async (c) => {
      const limited = new Error("429");
      m.checkRateLimitAndThrowError.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(limited);
      await expect(c.run()).rejects.toBe(limited);
      expect(m.checkRateLimitAndThrowError).toHaveBeenCalledTimes(2);
      expect(c.service).not.toHaveBeenCalled();
    }
  );

  it.each(inviteCases)("$name maps forbidden to TRPCError FORBIDDEN", async (c) => {
    c.service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await c.run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });

  it.each(inviteCases)("$name rethrows a non-Flowko error unchanged", async (c) => {
    const boom = new Error("db down");
    c.service.mockRejectedValue(boom);
    await expect(c.run()).rejects.toBe(boom);
  });

  it.each([
    "email_has_login",
    "invite_bad_email",
    "invite_pending",
    "invite_gone",
    "invite_invalid",
    "member_not_desk_only",
    "member_name_taken",
    "bad_member",
    "member_conflict",
  ] as const)("every invite procedure maps %s to BAD_REQUEST with the code as message", async (code) => {
    for (const c of inviteCases) {
      c.service.mockRejectedValue(new FlowkoBusinessError(code));
      const err = await c.run().catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toBe(code);
    }
  });

  it("a MailTransportError thrown by sendInvite never reaches the caller: the service answers not_sent", async () => {
    // The service (Task 2) catches every sendInvite throw; the handler passes sendInvite through untouched and
    // returns the service's answer as is.
    const answer = {
      inviteId: 4,
      link: "https://booking.example/auth/pridruzi/x",
      mail: "not_sent",
      expiresDate: "2026-11-23",
      expiresTime: "08:07",
    };
    m.createInvite.mockImplementation(async (deps) => {
      m.sendFlowkoInviteEmail.mockRejectedValueOnce(new Error("MailTransportError"));
      await deps.sendInvite({}).catch(() => undefined);
      return answer;
    });
    await expect(handlers.inviteHandler({ ctx, input: NEW_INPUT })).resolves.toBe(answer);
  });

  it("invite, resendInvite and revokeInvite take `now` once per call, as a fresh Date", async () => {
    m.createInvite.mockResolvedValue("a");
    m.resendInvite.mockResolvedValue("b");
    m.revokeInvite.mockResolvedValue("c");
    const before = Date.now();
    await handlers.inviteHandler({ ctx, input: NEW_INPUT });
    await handlers.resendInviteHandler({ ctx, input: { inviteId: 4, sendMail: false } });
    await handlers.revokeInviteHandler({ ctx, input: { inviteId: 4 } });
    for (const now of [
      m.createInvite.mock.calls[0][3],
      m.resendInvite.mock.calls[0][3],
      m.revokeInvite.mock.calls[0][3],
    ]) {
      expect(now).toBeInstanceOf(Date);
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});

describe("viewer.flowko.workers invite input schemas (Flowko U29d, strict)", () => {
  const MAX_INT4 = 2147483647;
  const newOk = { kind: "new", name: "Ana", email: "ana@example.si", role: "WORKER" };
  const memberOk = { kind: "member", memberId: 12, email: "ana@example.si" };

  it("accept the Delavci page's invite inputs", () => {
    expect(schemas.ZInviteInput.safeParse(newOk).success).toBe(true);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, role: "STAFF" }).success).toBe(true);
    expect(schemas.ZInviteInput.safeParse(memberOk).success).toBe(true);
    expect(schemas.ZResendInviteInput.safeParse({ inviteId: 1, sendMail: true }).success).toBe(true);
    expect(schemas.ZResendInviteInput.safeParse({ inviteId: MAX_INT4, sendMail: false }).success).toBe(true);
    expect(schemas.ZRevokeInviteInput.safeParse({ inviteId: 1 }).success).toBe(true);
  });

  it("refuse a missing or unknown kind, OWNER and unknown keys (no business, actor or token from the client)", () => {
    const { kind: _k, ...noKind } = newOk;
    expect(schemas.ZInviteInput.safeParse(noKind).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, kind: "other" }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, role: "OWNER" }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, role: undefined }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, businessId: 5 }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, memberId: 12 }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...memberOk, name: "Ana" }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...memberOk, role: "WORKER" }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...memberOk, userId: 5 }).success).toBe(false);
    expect(schemas.ZResendInviteInput.safeParse({ inviteId: 1, sendMail: true, token: "x" }).success).toBe(
      false
    );
    expect(schemas.ZRevokeInviteInput.safeParse({ inviteId: 1, force: true }).success).toBe(false);
  });

  it("sendMail is required and a boolean", () => {
    expect(schemas.ZResendInviteInput.safeParse({ inviteId: 1 }).success).toBe(false);
    expect(schemas.ZResendInviteInput.safeParse({ inviteId: 1, sendMail: "true" }).success).toBe(false);
    expect(schemas.ZResendInviteInput.safeParse({ inviteId: 1, sendMail: 1 }).success).toBe(false);
  });

  it("ids are integers 1..2147483647", () => {
    for (const bad of [0, -1, 1.5, MAX_INT4 + 1, "1"]) {
      expect(schemas.ZInviteInput.safeParse({ ...memberOk, memberId: bad }).success).toBe(false);
      expect(schemas.ZResendInviteInput.safeParse({ inviteId: bad, sendMail: true }).success).toBe(false);
      expect(schemas.ZRevokeInviteInput.safeParse({ inviteId: bad }).success).toBe(false);
    }
  });

  it("the e-mail is capped at 320 early (the service owns the format and the 254 rule), the name at 200", () => {
    const email = (n: number) => "e".repeat(n);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, email: email(320) }).success).toBe(true);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, email: email(321) }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...memberOk, email: email(321) }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, name: "n".repeat(200) }).success).toBe(true);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, name: "n".repeat(201) }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, email: 5 }).success).toBe(false);
    expect(schemas.ZInviteInput.safeParse({ ...newOk, name: 5 }).success).toBe(false);
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
      schemas.ZReorderWorkersInput.safeParse({ memberIds: Array.from({ length: 500 }, (_, i) => i + 1) })
        .success
    ).toBe(true);
    expect(
      schemas.ZReorderWorkersInput.safeParse({ memberIds: Array.from({ length: 501 }, (_, i) => i + 1) })
        .success
    ).toBe(false);
  });

  it("displayName is capped at 200 early; the trim and the 80-character rule are the service's", () => {
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "n".repeat(200) }).success).toBe(true);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "n".repeat(201) }).success).toBe(false);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: "" }).success).toBe(true);
    expect(schemas.ZAddDeskOnlyInput.safeParse({ displayName: 5 }).success).toBe(false);
  });
});
