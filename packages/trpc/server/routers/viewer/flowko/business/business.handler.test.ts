// Flowko U27: viewer.flowko.business.me. getBusinessAccess is mocked (it has its own tests); this pins the shape,
// the null for a non-member, hidesCalScreens and that no rate limit applies.
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getBusinessAccess: vi.fn(),
  listDeskServices: vi.fn(),
  listDeskMembers: vi.fn(),
  checkRateLimitAndThrowError: vi.fn(),
  prisma: { flowkoBusiness: { findUnique: vi.fn() } },
}));

vi.mock("@calcom/prisma", () => ({ prisma: m.prisma, default: m.prisma }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: m.checkRateLimitAndThrowError,
}));
vi.mock("@calcom/features/flowkoBusiness/access", () => ({ getBusinessAccess: m.getBusinessAccess }));
vi.mock("@calcom/features/flowkoBusiness/desk", () => ({
  listDeskServices: m.listDeskServices,
  listDeskMembers: m.listDeskMembers,
}));

import { FlowkoBusinessError } from "@calcom/features/flowkoBusiness/errors";

import { membersHandler, meHandler, servicesHandler } from "./business.handler";

const ctx = { user: { id: 7 } } as never;

describe("viewer.flowko.business.me (Flowko U27)", () => {
  beforeEach(() => {
    m.getBusinessAccess.mockReset();
    m.prisma.flowkoBusiness.findUnique.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
  });

  it("a non-member gets null and the business is not read", async () => {
    m.getBusinessAccess.mockResolvedValue(null);
    await expect(meHandler({ ctx })).resolves.toBeNull();
    expect(m.getBusinessAccess).toHaveBeenCalledWith(m.prisma, 7);
    expect(m.prisma.flowkoBusiness.findUnique).not.toHaveBeenCalled();
  });

  it("an owner gets the business, member and role; Cal screens stay visible", async () => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 11, userId: 7, role: "OWNER" });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue({ name: "Salon Lila", slug: "salon-lila" });
    await expect(meHandler({ ctx })).resolves.toEqual({
      businessId: 5,
      businessName: "Salon Lila",
      businessSlug: "salon-lila",
      memberId: 11,
      role: "OWNER",
      hidesCalScreens: false,
    });
    expect(m.prisma.flowkoBusiness.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { name: true, slug: true },
    });
  });

  it.each(["WORKER", "STAFF"])("a %s hides the Cal screens", async (role) => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 12, userId: 7, role });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue({ name: "Salon Lila", slug: "salon-lila" });
    const me = (await meHandler({ ctx })) as { role: string; hidesCalScreens: boolean };
    expect(me.role).toBe(role);
    expect(me.hidesCalScreens).toBe(true);
  });

  it("a business that vanished between the two reads gives null", async () => {
    m.getBusinessAccess.mockResolvedValue({ businessId: 5, memberId: 11, userId: 7, role: "OWNER" });
    m.prisma.flowkoBusiness.findUnique.mockResolvedValue(null);
    await expect(meHandler({ ctx })).resolves.toBeNull();
  });

  it("is not rate limited", async () => {
    m.getBusinessAccess.mockResolvedValue(null);
    await meHandler({ ctx });
    expect(m.checkRateLimitAndThrowError).not.toHaveBeenCalled();
  });

  it("maps a Flowko error through flowkoTrpcError and rethrows others unchanged", async () => {
    m.getBusinessAccess.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await meHandler({ ctx }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    const boom = new Error("db down");
    m.getBusinessAccess.mockRejectedValue(boom);
    await expect(meHandler({ ctx })).rejects.toBe(boom);
  });
});

// Flowko U28: desk reads, own rate-limit bucket.
describe.each([
  ["services", servicesHandler, m.listDeskServices],
  ["members", membersHandler, m.listDeskMembers],
] as const)("viewer.flowko.business.%s (Flowko U28)", (_name, handler, service) => {
  beforeEach(() => {
    service.mockReset();
    m.checkRateLimitAndThrowError.mockReset();
    m.checkRateLimitAndThrowError.mockResolvedValue({ success: true });
  });

  it("calls its service with the session user id, after the flowkoDesk:<id> limiter", async () => {
    service.mockResolvedValue("result");
    await expect(handler({ ctx })).resolves.toBe("result");
    expect(service).toHaveBeenCalledWith(m.prisma, 7);
    expect(m.checkRateLimitAndThrowError).toHaveBeenCalledWith({
      identifier: "flowkoDesk:7",
      rateLimitingType: "common",
    });
    expect(m.checkRateLimitAndThrowError.mock.invocationCallOrder[0]).toBeLessThan(
      service.mock.invocationCallOrder[0]
    );
  });

  it("a rate-limit refusal stops the call before the service runs", async () => {
    const limited = new Error("429");
    m.checkRateLimitAndThrowError.mockRejectedValue(limited);
    await expect(handler({ ctx })).rejects.toBe(limited);
    expect(service).not.toHaveBeenCalled();
  });

  it("maps forbidden to FORBIDDEN and rethrows others unchanged", async () => {
    service.mockRejectedValue(new FlowkoBusinessError("forbidden"));
    const err = await handler({ ctx }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    const boom = new Error("db down");
    service.mockRejectedValue(boom);
    await expect(handler({ ctx })).rejects.toBe(boom);
  });
});
