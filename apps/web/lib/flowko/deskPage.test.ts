// Flowko U28: deskHomeFor / requireDeskAccess and the landing page. Business A: Olga (OWNER), Ana (WORKER), Rok
// (STAFF), Dan (locked WORKER); a stranger in no business. Real helpers on prismock through the global client;
// redirect and the session are mocked. The landing page is app/page.tsx: onboarding check first, then the desk.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  getServerSession: vi.fn(),
  checkOnboardingRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: (...args: unknown[]) => mocks.getServerSession(...args),
}));
vi.mock("@calcom/features/auth/lib/onboardingUtils", () => ({
  checkOnboardingRedirect: (...args: unknown[]) => mocks.checkOnboardingRedirect(...args),
}));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: () => ({}) }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/lib/markdownToSafeHTML", () => ({
  markdownToSafeHTML: (text: string | null) => text ?? "",
}));

import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import RedirectPage from "../../app/page";
import { deskHomeFor, FLOWKO_MEMBER_HOME, requireDeskAccess } from "./deskPage";

const db = prismock as unknown as FlowkoDb;
let seq = 0;

async function makeUser(name: string): Promise<{ id: number }> {
  seq += 1;
  const username = `${name.toLowerCase()}${seq}`;
  const user = await prismock.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  return { id: user.id };
}

type Fixture = {
  olga: { id: number };
  ana: { id: number };
  rok: { id: number };
  dan: { id: number };
  stranger: { id: number };
  businessId: number;
};
let f: Fixture;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.checkOnboardingRedirect.mockResolvedValue(null);
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga.id,
    name: "Salon Desk",
    slug: `salon-desk-${seq}`,
    templateId: "hair-salon",
    phone: "+386 1 234 56 78",
    address: "Slovenska cesta 1, Ljubljana",
  });
  const ana = await makeUser("Ana");
  const rok = await makeUser("Rok");
  const dan = await makeUser("Dan");
  const stranger = await makeUser("Stranger");
  await addLoginMember(db, created.businessId, ana.id, FlowkoBusinessRole.WORKER);
  await addLoginMember(db, created.businessId, rok.id, FlowkoBusinessRole.STAFF);
  const danMember = await addLoginMember(db, created.businessId, dan.id, FlowkoBusinessRole.WORKER);
  await prismock.flowkoBusinessMember.update({
    where: { id: danMember.memberId },
    data: { status: FlowkoMemberStatus.LOCKED, lockedAt: new Date() },
  });
  f = { olga, ana, rok, dan, stranger, businessId: created.businessId };
});

describe("deskHomeFor", () => {
  it("is /koledar for every active member, whatever the role", async () => {
    expect(FLOWKO_MEMBER_HOME).toBe("/koledar");
    await expect(deskHomeFor(f.olga.id)).resolves.toBe("/koledar");
    await expect(deskHomeFor(f.ana.id)).resolves.toBe("/koledar");
    await expect(deskHomeFor(f.rok.id)).resolves.toBe("/koledar");
  });

  it("is null for a locked member, a stranger and an unknown user", async () => {
    await expect(deskHomeFor(f.dan.id)).resolves.toBeNull();
    await expect(deskHomeFor(f.stranger.id)).resolves.toBeNull();
    await expect(deskHomeFor(987654)).resolves.toBeNull();
  });
});

describe("requireDeskAccess", () => {
  it("returns the business id for a member", async () => {
    await expect(requireDeskAccess(f.ana.id)).resolves.toEqual({ businessId: f.businessId });
    await expect(requireDeskAccess(f.olga.id)).resolves.toEqual({ businessId: f.businessId });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["a locked member", () => f.dan.id],
    ["a stranger", () => f.stranger.id],
  ])("sends %s to the bookings list", async (_name, id) => {
    await expect(requireDeskAccess(id())).rejects.toThrow("NEXT_REDIRECT /bookings/upcoming");
    expect(mocks.redirect).toHaveBeenCalledWith("/bookings/upcoming");
  });
});

describe("the landing page (app/page.tsx)", () => {
  it("sends a signed-out visitor to the login", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    await expect(RedirectPage()).rejects.toThrow("NEXT_REDIRECT /auth/login");
  });

  it.each([
    ["Olga (OWNER)", () => f.olga.id],
    ["Ana (WORKER)", () => f.ana.id],
    ["Rok (STAFF)", () => f.rok.id],
  ])("%s lands on /koledar", async (_name, id) => {
    mocks.getServerSession.mockResolvedValue({ user: { id: id(), profile: null } });
    await expect(RedirectPage()).rejects.toThrow("NEXT_REDIRECT /koledar");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it("a user in no business (and a locked member) lands on /event-types", async () => {
    for (const id of [f.stranger.id, f.dan.id]) {
      mocks.redirect.mockClear();
      mocks.getServerSession.mockResolvedValue({ user: { id, profile: null } });
      await expect(RedirectPage()).rejects.toThrow("NEXT_REDIRECT /event-types");
    }
  });

  it("the onboarding check comes first, even for a member", async () => {
    mocks.checkOnboardingRedirect.mockResolvedValue("/getting-started");
    mocks.getServerSession.mockResolvedValue({ user: { id: f.ana.id, profile: null } });
    await expect(RedirectPage()).rejects.toThrow("NEXT_REDIRECT /getting-started");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});
