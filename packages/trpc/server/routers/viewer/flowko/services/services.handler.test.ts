// Flowko U29a: viewer.flowko.services.* API handlers + strict input shapes (S14). The services are mocked (services.ts
// has its own unit and Postgres tests); this file pins what the API layer adds: the actor is always ctx.user.id, the
// flowkoSettings:<id> bucket runs before the service, the error mapping (forbidden → FORBIDDEN; bad_service,
// bad_member, service_name_taken → BAD_REQUEST with the code) and the exact input shapes.
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listServicesForOwner: vi.fn(),
  saveService: vi.fn(),
  removeService: vi.fn(),
  reorderServices: vi.fn(),
  checkRateLimitAndThrowError: vi.fn(),
  prisma: { marker: "prisma" },
}));

vi.mock("@calcom/prisma", () => ({ prisma: m.prisma, default: m.prisma }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: m.checkRateLimitAndThrowError,
}));
vi.mock("@calcom/features/flowkoBusiness/services", () => ({
  listServicesForOwner: m.listServicesForOwner,
  saveService: m.saveService,
  removeService: m.removeService,
  reorderServices: m.reorderServices,
}));

import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";

import * as handlers from "./services.handler";
import * as schemas from "./services.schema";

const ctx = { user: { id: 7 } } as never;
const barvanje = {
  name: "Barvanje",
  category: "Barvanje",
  steps: [
    { kind: "busy" as const, minutes: 30 },
    { kind: "processing" as const, minutes: 40 },
    { kind: "busy" as const, minutes: 30 },
  ],
  workerMemberIds: [3, 4],
};

type Case = {
  name: string;
  service: ReturnType<typeof vi.fn>;
  run: () => Promise<unknown>;
  args: unknown[];
};

const cases: Case[] = [
  {
    name: "list",
    service: m.listServicesForOwner,
    run: () => handlers.listHandler({ ctx }),
    args: [m.prisma, 7, expect.any(Date)],
  },
  {
    name: "save (new)",
    service: m.saveService,
    run: () => handlers.saveHandler({ ctx, input: barvanje }),
    args: [m.prisma, 7, barvanje],
  },
  {
    name: "save (edit)",
    service: m.saveService,
    run: () => handlers.saveHandler({ ctx, input: { ...barvanje, id: 12 } }),
    args: [m.prisma, 7, { ...barvanje, id: 12 }],
  },
  {
    name: "remove",
    service: m.removeService,
    run: () => handlers.removeHandler({ ctx, input: { serviceId: 12 } }),
    args: [m.prisma, 7, 12],
  },
  {
    name: "reorder",
    service: m.reorderServices,
    run: () => handlers.reorderHandler({ ctx, input: { serviceIds: [13, 12] } }),
    args: [m.prisma, 7, [13, 12]],
  },
];

describe("viewer.flowko.services handlers (Flowko U29a)", () => {
  beforeEach(() => {
    for (const c of cases) c.service.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it.each(cases)("$name calls its service with the session user id, never one from the input", async (c) => {
    c.service.mockResolvedValue("result");
    await expect(c.run()).resolves.toBe("result");
    expect(c.service).toHaveBeenCalledTimes(1);
    expect(c.service.mock.calls[0]).toEqual(c.args);
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
    ["save", "service_name_taken", () => handlers.saveHandler({ ctx, input: barvanje }), m.saveService],
    ["save", "bad_service", () => handlers.saveHandler({ ctx, input: barvanje }), m.saveService],
    ["save", "bad_member", () => handlers.saveHandler({ ctx, input: barvanje }), m.saveService],
    // Task 3 ruling (S13): a list with a foreign or unknown id is bad_service (stale list), not forbidden.
    [
      "reorder",
      "bad_service",
      () => handlers.reorderHandler({ ctx, input: { serviceIds: [12, 999] } }),
      m.reorderServices,
    ],
  ] as const)("%s maps %s to BAD_REQUEST with the code as message", async (_name, code, run, service) => {
    service.mockRejectedValue(new FlowkoBusinessError(code));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe(code);
  });

  it("save and remove with another business's service id answer FORBIDDEN (the service's forbidden)", async () => {
    m.saveService.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    m.removeService.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const saved = await handlers.saveHandler({ ctx, input: { ...barvanje, id: 999 } }).catch((e) => e);
    const removed = await handlers.removeHandler({ ctx, input: { serviceId: 999 } }).catch((e) => e);
    expect(saved.code).toBe("FORBIDDEN");
    expect(removed.code).toBe("FORBIDDEN");
  });

  it("save passes only the editor's fields (no position, price or online flag reach the service)", async () => {
    m.saveService.mockResolvedValue({ serviceId: 12 });
    await expect(handlers.saveHandler({ ctx, input: { ...barvanje, id: 12 } })).resolves.toEqual({ serviceId: 12 });
    expect(Object.keys(m.saveService.mock.calls[0][2]).sort()).toEqual(
      ["category", "id", "name", "steps", "workerMemberIds"].sort()
    );
  });
});

describe("viewer.flowko.services input schemas (Flowko U29a, strict)", () => {
  const MAX_INT4 = 2147483647;

  it("accept the editor's inputs", () => {
    expect(schemas.ZSaveServiceInput.safeParse(barvanje).success).toBe(true);
    expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, id: MAX_INT4, category: null }).success).toBe(true);
    expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, workerMemberIds: [] }).success).toBe(true);
    expect(schemas.ZRemoveServiceInput.safeParse({ serviceId: 1 }).success).toBe(true);
    expect(schemas.ZReorderServicesInput.safeParse({ serviceIds: [3, 1, 2] }).success).toBe(true);
  });

  it("refuse unknown keys at every level (no price, online flag, grid or position)", () => {
    for (const extra of [{ priceCents: 2000 }, { onlineBookable: true }, { slotGridMinutes: 15 }, { position: 0 }]) {
      expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, ...extra }).success).toBe(false);
    }
    expect(
      schemas.ZSaveServiceInput.safeParse({ ...barvanje, steps: [{ kind: "busy", minutes: 30, label: "x" }] })
        .success
    ).toBe(false);
    expect(schemas.ZRemoveServiceInput.safeParse({ serviceId: 1, force: true }).success).toBe(false);
    expect(schemas.ZReorderServicesInput.safeParse({ serviceIds: [1], businessId: 5 }).success).toBe(false);
  });

  it("ids are integers 1..2147483647", () => {
    for (const bad of [0, -1, 1.5, MAX_INT4 + 1, "1"]) {
      expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, id: bad }).success).toBe(false);
      expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, workerMemberIds: [bad] }).success).toBe(false);
      expect(schemas.ZRemoveServiceInput.safeParse({ serviceId: bad }).success).toBe(false);
      expect(schemas.ZReorderServicesInput.safeParse({ serviceIds: [1, bad] }).success).toBe(false);
    }
  });

  it("a missing field is refused (category must be sent, null when empty)", () => {
    for (const key of ["name", "category", "steps", "workerMemberIds"]) {
      const { [key]: _gone, ...rest } = barvanje as Record<string, unknown>;
      expect(schemas.ZSaveServiceInput.safeParse(rest).success, key).toBe(false);
    }
    expect(schemas.ZRemoveServiceInput.safeParse({}).success).toBe(false);
    expect(schemas.ZReorderServicesInput.safeParse({}).success).toBe(false);
  });

  it("step kinds are busy/processing; minutes a finite number", () => {
    const withStep = (step: unknown) => schemas.ZSaveServiceInput.safeParse({ ...barvanje, steps: [step] }).success;
    expect(withStep({ kind: "waiting", minutes: 30 })).toBe(false);
    expect(withStep({ kind: "busy", minutes: "30" })).toBe(false);
    expect(withStep({ kind: "busy", minutes: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("oversized payloads are refused early; the editor rules themselves are the service's (bad_service)", () => {
    expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, name: "n".repeat(501) }).success).toBe(false);
    expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, category: "c".repeat(501) }).success).toBe(false);
    const step = { kind: "busy", minutes: 5 };
    expect(
      schemas.ZSaveServiceInput.safeParse({ ...barvanje, steps: Array.from({ length: 51 }, () => step) }).success
    ).toBe(false);
    expect(
      schemas.ZReorderServicesInput.safeParse({ serviceIds: Array.from({ length: 501 }, (_, i) => i + 1) }).success
    ).toBe(false);
    // 9 steps or a 61-character name break the editor rules: that answer is the service's bad_service.
    expect(
      schemas.ZSaveServiceInput.safeParse({ ...barvanje, steps: Array.from({ length: 9 }, () => step) }).success
    ).toBe(true);
    expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, name: "n".repeat(61) }).success).toBe(true);
    // A repeated worker is the service's bad_member (Task 3 ruling), not a zod message.
    expect(schemas.ZSaveServiceInput.safeParse({ ...barvanje, workerMemberIds: [3, 3] }).success).toBe(true);
  });
});
