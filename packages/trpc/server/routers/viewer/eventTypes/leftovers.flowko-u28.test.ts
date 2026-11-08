// Flowko U28 (R16 a): the worker mirrors stay out of the owner's remaining Cal lists (eventTypes.list, getByViewer,
// listWithTeam) and out of by-id reads (eventTypes.get answers NOT_FOUND for a mirror id). Olga (OWNER of a business)
// has a mirror and one ordinary event type; a stranger in no business has one ordinary type. Real handlers and the
// real mirror helpers on prismock through the global client; what the handlers call beyond that is mocked.
// listWithTeam is a raw UNION query (prismock's $queryRaw always answers []): its rows are checked on Postgres in
// listWithTeam.flowko-u28.integration-test.ts, and here by a source assertion on the SQL.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getEventTypeById: vi.fn() }));

vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/lib/markdownToSafeHTML", () => ({
  markdownToSafeHTML: (text: string | null) => text ?? "",
}));
vi.mock("@calcom/features/eventtypes/lib/getEventTypeById", () => ({ default: mocks.getEventTypeById }));

import { getEventTypesByViewer } from "@calcom/features/eventtypes/lib/getEventTypesByViewer";
import { createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import { getHandler } from "./get.handler";
import { listHandler } from "./list.handler";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
let seq = 0;

async function makeUser(name: string): Promise<{ id: number }> {
  seq += 1;
  const username = `${name.toLowerCase()}${seq}`;
  return prismock.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
}

type Fixture = {
  olga: { id: number };
  stranger: { id: number };
  olgaMirror: { eventTypeId: number };
  olgaOrdinary: { id: number };
  strangerOrdinary: { id: number };
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  await createBusiness(db, {
    ownerUserId: olga.id,
    name: "Salon Leftovers",
    slug: `salon-leftovers-${seq}`,
    templateId: "hair-salon",
    phone: "+386 1 234 56 78",
    address: "Slovenska cesta 1, Ljubljana",
  });
  const stranger = await makeUser("Stranger");
  const olgaMember = await prismock.flowkoBusinessMember.findUnique({
    where: { userId: olga.id },
    select: { id: true },
  });
  // Olga's ordinary schedule first and as her default (the mirror keeps the usual default, M5).
  const schedule = await prismock.schedule.create({
    data: { name: "Working hours", userId: olga.id, timeZone: "Europe/Ljubljana" },
    select: { id: true },
  });
  await prismock.user.update({ where: { id: olga.id }, data: { defaultScheduleId: schedule.id } });
  const olgaMirror = await ensureWorkerMirror(tx, olgaMember!.id);
  const olgaOrdinary = await prismock.eventType.create({
    data: { title: "Olga ordinary", slug: `olga-ordinary-${seq}`, length: 30, userId: olga.id },
    select: { id: true },
  });
  const strangerOrdinary = await prismock.eventType.create({
    data: { title: "Stranger ordinary", slug: `stranger-ordinary-${seq}`, length: 30, userId: stranger.id },
    select: { id: true },
  });
  return { olga, stranger, olgaMirror: { eventTypeId: olgaMirror.eventTypeId }, olgaOrdinary, strangerOrdinary };
}

let f: Fixture;

beforeEach(async () => {
  mocks.getEventTypeById.mockReset();
  mocks.getEventTypeById.mockResolvedValue({ eventType: { id: 0 } });
  f = await setUp();
});

const listCtx = (userId: number) =>
  ({ user: { id: userId } }) as unknown as Parameters<typeof listHandler>[0]["ctx"];

describe("eventTypes.list leaves the mirror out", () => {
  it("the fixture really has a mirror next to the ordinary type", async () => {
    const rows = await prismock.eventType.findMany({ where: { userId: f.olga.id } });
    expect(rows.map((r) => r.id).sort()).toEqual([f.olgaMirror.eventTypeId, f.olgaOrdinary.id].sort());
  });

  it("returns only Olga's ordinary type", async () => {
    const rows = await listHandler({ ctx: listCtx(f.olga.id) });
    expect(rows.map((r) => r.id)).toEqual([f.olgaOrdinary.id]);
  });

  it("a user without a mirror is unchanged", async () => {
    const rows = await listHandler({ ctx: listCtx(f.stranger.id) });
    expect(rows.map((r) => r.id)).toEqual([f.strangerOrdinary.id]);
  });
});

describe("getByViewer (getEventTypesByViewer) leaves the mirror out", () => {
  const viewer = (userId: number) => ({ id: userId, profile: { upId: `usr-${userId}` } });
  const ids = (result: Awaited<ReturnType<typeof getEventTypesByViewer>>) =>
    result.eventTypeGroups.flatMap((g) => g.eventTypes.map((e) => e.id));

  it("lists only Olga's ordinary type", async () => {
    const result = await getEventTypesByViewer(viewer(f.olga.id));
    expect(ids(result)).toEqual([f.olgaOrdinary.id]);
  });

  it("a user without a mirror is unchanged", async () => {
    const result = await getEventTypesByViewer(viewer(f.stranger.id));
    expect(ids(result)).toEqual([f.strangerOrdinary.id]);
  });
});

describe("eventTypes.get answers NOT_FOUND for a mirror id", () => {
  const getCtx = (userId: number) =>
    ({
      user: { id: userId, profile: { organizationId: null }, organization: null, locale: "sl" },
      prisma: prismock,
    }) as unknown as Parameters<typeof getHandler>[0]["ctx"];

  it("a mirror id is refused, for its owner too, and the by-id read is never reached", async () => {
    await expect(
      getHandler({ ctx: getCtx(f.olga.id), input: { id: f.olgaMirror.eventTypeId } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getEventTypeById).not.toHaveBeenCalled();
  });

  it("an ordinary id still goes to the by-id read", async () => {
    await getHandler({ ctx: getCtx(f.olga.id), input: { id: f.olgaOrdinary.id } });
    expect(mocks.getEventTypeById).toHaveBeenCalledTimes(1);
    expect(mocks.getEventTypeById.mock.calls[0][0]).toMatchObject({ eventTypeId: f.olgaOrdinary.id });
  });
});

describe("listWithTeam's personal arm excludes mirrors (source; rows on Postgres in the integration test)", () => {
  const source = readFileSync(resolve(__dirname, "listWithTeam.handler.ts"), "utf8");
  const firstArm = source.slice(source.indexOf("SELECT"), source.indexOf("UNION"));
  const secondArm = source.slice(source.indexOf("UNION"));

  it("the first (personal) arm has the NOT EXISTS clause on FlowkoWorkerMirror", () => {
    expect(firstArm).toContain(
      'NOT EXISTS (SELECT 1 FROM "FlowkoWorkerMirror" m WHERE m."eventTypeId" = "public"."EventType"."id")'
    );
  });

  it("the team arm is untouched (a mirror never has a team)", () => {
    expect(secondArm).not.toContain("FlowkoWorkerMirror");
  });
});
