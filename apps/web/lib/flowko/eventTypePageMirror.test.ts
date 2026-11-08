// Flowko U28 (R16 a): /event-types/[type] answers notFound() for a worker mirror's id (for its owner too) and
// goes on to the Cal screen for an ordinary id. The real page and the real mirror lookup on prismock through the
// global client; the session, the tRPC caller and the screen component are mocked.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  get: vi.fn(),
  userId: 0,
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({})) }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: mocks.userId } })),
}));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: vi.fn(() => ({})) }));
vi.mock("app/_trpc/context", () => ({
  createRouterCaller: vi.fn(async () => ({ get: mocks.get })),
  getTRPCContext: vi.fn(async () => ({})),
}));
vi.mock("app/_utils", () => ({ _generateMetadata: vi.fn() }));
vi.mock("@calcom/trpc/server/routers/viewer/eventTypes/_router", () => ({ eventTypesRouter: {} }));
vi.mock("@calcom/web/modules/event-types/components/EventTypeWebWrapper", () => ({
  EventTypeWebWrapper: () => null,
}));

import { createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import ServerPage from "../../app/(use-page-wrapper)/event-types/[type]/page";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;

let mirrorId: number;
let ordinaryId: number;

const render = (id: number) => ServerPage({ params: Promise.resolve({ type: String(id) }) } as never);

beforeEach(async () => {
  mocks.notFound.mockClear();
  mocks.get.mockReset();
  mocks.get.mockResolvedValue({ eventType: { id: 1 } });
  const olga = await prismock.user.create({
    data: { email: `olga-${Date.now()}@example.com`, username: `olga-${Date.now()}`, name: "Olga" },
    select: { id: true },
  });
  mocks.userId = olga.id;
  await createBusiness(db, {
    ownerUserId: olga.id,
    name: "Salon Page",
    slug: `salon-page-${olga.id}`,
    templateId: "hair-salon",
    phone: "+386 1 234 56 78",
    address: "Slovenska cesta 1, Ljubljana",
  });
  const member = await prismock.flowkoBusinessMember.findUnique({
    where: { userId: olga.id },
    select: { id: true },
  });
  const schedule = await prismock.schedule.create({
    data: { name: "Working hours", userId: olga.id, timeZone: "Europe/Ljubljana" },
    select: { id: true },
  });
  await prismock.user.update({ where: { id: olga.id }, data: { defaultScheduleId: schedule.id } });
  mirrorId = (await ensureWorkerMirror(tx, member!.id)).eventTypeId;
  ordinaryId = (
    await prismock.eventType.create({
      data: { title: "Ordinary", slug: `ordinary-${olga.id}`, length: 30, userId: olga.id },
      select: { id: true },
    })
  ).id;
});

describe("/event-types/[type] and a worker mirror (R16 a)", () => {
  it("answers notFound() for the mirror's id, for its owner, and never reads the event type", async () => {
    await expect(render(mirrorId)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("an ordinary id reaches the event-type read", async () => {
    await render(ordinaryId);
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledWith({ id: ordinaryId });
  });
});
