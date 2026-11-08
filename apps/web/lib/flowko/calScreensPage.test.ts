// Flowko U27: Cal's lists leave the worker mirrors out, and Cal's event-type, availability and out-of-office pages
// redirect non-owner business members. Business A: Olga (OWNER) with a mirror, an ordinary event type and an
// ordinary schedule; Ana (WORKER), Rok (STAFF), Dan (locked WORKER); a stranger in no business. Real handlers and
// the real helper on prismock through the global client; everything else the handlers call is mocked. The six pages
// are pinned by source assertions (each reads the session, then calls the helper), as teamsGuard.test.ts reads source.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
import "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/lib/markdownToSafeHTML", () => ({
  markdownToSafeHTML: (text: string | null) => text ?? "",
}));

import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import { listHandler } from "@calcom/trpc/server/routers/viewer/availability/list.handler";
import { bulkEventFetchHandler } from "@calcom/trpc/server/routers/viewer/eventTypes/bulkEventFetch.handler";
import { getEventTypesFromGroup } from "@calcom/trpc/server/routers/viewer/eventTypes/getEventTypesFromGroup.handler";
import { redirectIfCalScreensHidden } from "./calScreensPage";

const db = prismock as unknown as FlowkoDb;
const tx = prismock as unknown as Prisma.TransactionClient;
const BUSINESS_NAME = "Salon Screens"; // = the title of every mirror event type
let seq = 0;

async function makeUser(name: string): Promise<{ id: number; username: string }> {
  seq += 1;
  const username = `${name.toLowerCase()}${seq}`;
  const user = await prismock.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  return { id: user.id, username };
}

type Fixture = {
  olga: { id: number; username: string };
  ana: { id: number };
  rok: { id: number };
  dan: { id: number };
  stranger: { id: number; username: string };
  olgaMirror: { eventTypeId: number; scheduleId: number };
  olgaOrdinary: { id: number };
  olgaSchedule: { id: number };
  strangerOrdinary: { id: number };
};

async function setUp(): Promise<Fixture> {
  const olga = await makeUser("Olga");
  const created = await createBusiness(db, {
    ownerUserId: olga.id,
    name: BUSINESS_NAME,
    slug: `salon-screens-${seq}`,
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
  const olgaMember = await prismock.flowkoBusinessMember.findUnique({
    where: { userId: olga.id },
    select: { id: true },
  });

  // Olga's ordinary schedule first and as her default (the mirror keeps the usual default, M5).
  const olgaSchedule = await prismock.schedule.create({
    data: { name: "Working hours", userId: olga.id, timeZone: "Europe/Ljubljana" },
    select: { id: true },
  });
  await prismock.user.update({ where: { id: olga.id }, data: { defaultScheduleId: olgaSchedule.id } });
  const olgaMirror = await ensureWorkerMirror(tx, olgaMember!.id);
  const olgaOrdinary = await prismock.eventType.create({
    data: { title: "Olga ordinary", slug: `olga-ordinary-${seq}`, length: 30, userId: olga.id },
    select: { id: true },
  });
  const strangerOrdinary = await prismock.eventType.create({
    data: { title: "Stranger ordinary", slug: `stranger-ordinary-${seq}`, length: 30, userId: stranger.id },
    select: { id: true },
  });
  return {
    olga,
    ana,
    rok,
    dan,
    stranger,
    olgaMirror: { eventTypeId: olgaMirror.eventTypeId, scheduleId: olgaMirror.scheduleId },
    olgaOrdinary,
    olgaSchedule,
    strangerOrdinary,
  };
}

let f: Fixture;

beforeEach(async () => {
  mocks.redirect.mockClear();
  f = await setUp();
});

function groupCtx(userId: number, username: string) {
  const user = { id: userId, profile: { upId: `usr-${userId}`, username } };
  return {
    user: user as unknown as Parameters<typeof getEventTypesFromGroup>[0]["ctx"]["user"],
    prisma: prismock as unknown as Parameters<typeof getEventTypesFromGroup>[0]["ctx"]["prisma"],
  };
}

const groupInput = { group: { teamId: null, parentId: null }, limit: 10 } as Parameters<
  typeof getEventTypesFromGroup
>[0]["input"];

describe("Cal's lists leave the worker mirrors out", () => {
  it("the fixture really has a mirror next to the ordinary type and schedule", async () => {
    const rows = await prismock.eventType.findMany({ where: { userId: f.olga.id } });
    expect(rows.map((r) => r.id).sort()).toEqual([f.olgaMirror.eventTypeId, f.olgaOrdinary.id].sort());
    const schedules = await prismock.schedule.findMany({ where: { userId: f.olga.id } });
    expect(schedules.map((s) => s.id).sort()).toEqual([f.olgaMirror.scheduleId, f.olgaSchedule.id].sort());
  });

  it("getEventTypesFromGroup returns only Olga's ordinary type, and the page size and cursor stay right", async () => {
    const result = await getEventTypesFromGroup({
      ctx: groupCtx(f.olga.id, f.olga.username),
      input: groupInput,
    });
    expect(result.eventTypes.map((e) => e.id)).toEqual([f.olgaOrdinary.id]);
    expect(result.nextCursor).toBeUndefined();

    // limit 1 with a mirror between two ordinary types: the mirror must not take a slot of the page.
    const second = await prismock.eventType.create({
      data: { title: "Olga second", slug: `olga-second-${seq}`, length: 30, userId: f.olga.id },
      select: { id: true },
    });
    const paged = await getEventTypesFromGroup({
      ctx: groupCtx(f.olga.id, f.olga.username),
      input: { ...groupInput, limit: 1 },
    });
    expect(paged.eventTypes).toHaveLength(1);
    expect(paged.eventTypes.map((e) => e.id)).not.toContain(f.olgaMirror.eventTypeId);
    expect(paged.nextCursor).toBeDefined();
    expect([f.olgaOrdinary.id, second.id]).toContain(paged.nextCursor);
  });

  it("getEventTypesFromGroup for a user without a mirror is unchanged", async () => {
    const result = await getEventTypesFromGroup({
      ctx: groupCtx(f.stranger.id, f.stranger.username),
      input: groupInput,
    });
    expect(result.eventTypes.map((e) => e.id)).toEqual([f.strangerOrdinary.id]);
  });

  it("bulkEventFetch returns only the ordinary type; a user without a mirror is unchanged", async () => {
    const olga = await bulkEventFetchHandler({
      ctx: {
        user: { id: f.olga.id } as unknown as Parameters<typeof bulkEventFetchHandler>[0]["ctx"]["user"],
      },
    });
    expect(olga.eventTypes.map((e) => e.id)).toEqual([f.olgaOrdinary.id]);
    const stranger = await bulkEventFetchHandler({
      ctx: {
        user: { id: f.stranger.id } as unknown as Parameters<typeof bulkEventFetchHandler>[0]["ctx"]["user"],
      },
    });
    expect(stranger.eventTypes.map((e) => e.id)).toEqual([f.strangerOrdinary.id]);
  });

  it("availability.list leaves the mirror schedule out and keeps the ordinary one as the default", async () => {
    const result = await listHandler({
      ctx: { user: { id: f.olga.id, defaultScheduleId: f.olgaSchedule.id } },
    });
    expect(result.schedules.map((s) => s.id)).toEqual([f.olgaSchedule.id]);
    expect(result.schedules[0].isDefault).toBe(true);
  });

  it("availability.list for a user without a mirror is unchanged", async () => {
    const own = await prismock.schedule.create({
      data: { name: "Own", userId: f.stranger.id, timeZone: "Europe/Ljubljana" },
      select: { id: true },
    });
    const result = await listHandler({ ctx: { user: { id: f.stranger.id, defaultScheduleId: own.id } } });
    expect(result.schedules.map((s) => s.id)).toEqual([own.id]);
  });

  it("availability.list for a worker who only has the mirror schedule is empty and writes no default", async () => {
    const anaMember = await prismock.flowkoBusinessMember.findUnique({
      where: { userId: f.ana.id },
      select: { id: true },
    });
    const anaMirror = await ensureWorkerMirror(tx, anaMember!.id);
    const before = await prismock.user.findUnique({
      where: { id: f.ana.id },
      select: { defaultScheduleId: true },
    });
    const result = await listHandler({ ctx: { user: { id: f.ana.id, defaultScheduleId: null } } });
    expect(result.schedules).toEqual([]);
    const after = await prismock.user.findUnique({
      where: { id: f.ana.id },
      select: { defaultScheduleId: true },
    });
    expect(after?.defaultScheduleId).toBe(before?.defaultScheduleId);
    expect(after?.defaultScheduleId).not.toBe(anaMirror.scheduleId);
  });
  it("availability.list never makes the mirror schedule the default: null default, mirror schedule has the lowest id", async () => {
    const anaMember = await prismock.flowkoBusinessMember.findUnique({
      where: { userId: f.ana.id },
      select: { id: true },
    });
    // The mirror comes first (lowest schedule id); the ordinary schedule is created afterwards; no default is set.
    const anaMirror = await ensureWorkerMirror(tx, anaMember!.id);
    const ordinary = await prismock.schedule.create({
      data: { name: "Ana hours", userId: f.ana.id, timeZone: "Europe/Ljubljana" },
      select: { id: true },
    });
    expect(anaMirror.scheduleId).toBeLessThan(ordinary.id);
    const row = await prismock.user.findUnique({
      where: { id: f.ana.id },
      select: { defaultScheduleId: true },
    });
    expect(row?.defaultScheduleId).toBeNull();

    const result = await listHandler({ ctx: { user: { id: f.ana.id, defaultScheduleId: null } } });

    expect(result.schedules.map((s) => s.id)).toEqual([ordinary.id]);
    expect(result.schedules[0].isDefault).toBe(true);
    const after = await prismock.user.findUnique({
      where: { id: f.ana.id },
      select: { defaultScheduleId: true },
    });
    expect(after?.defaultScheduleId).toBe(ordinary.id);
    expect(after?.defaultScheduleId).not.toBe(anaMirror.scheduleId);
  });
});

describe("redirectIfCalScreensHidden", () => {
  it.each([
    ["Ana (WORKER)", () => f.ana.id],
    ["Rok (STAFF)", () => f.rok.id],
    ["Dan (locked WORKER)", () => f.dan.id],
  ])("%s goes to the desk", async (_name, id) => {
    // Flowko U28: was /bookings/upcoming; the desk sends a locked member on to the bookings list
    await expect(redirectIfCalScreensHidden(id())).rejects.toThrow("NEXT_REDIRECT /koledar");
    expect(mocks.redirect).toHaveBeenCalledWith("/koledar");
  });

  it.each([
    ["Olga (OWNER)", () => f.olga.id],
    ["a user in no business", () => f.stranger.id],
    ["an unknown user id", () => 987654],
  ])("%s is not redirected", async (_name, id) => {
    await expect(redirectIfCalScreensHidden(id())).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

const ROOT = resolve(__dirname, "../../../..");
const PAGES = [
  "apps/web/app/(use-page-wrapper)/(main-nav)/event-types/page.tsx",
  "apps/web/app/(use-page-wrapper)/event-types/[type]/page.tsx",
  "apps/web/app/(use-page-wrapper)/(main-nav)/availability/page.tsx",
  "apps/web/app/(use-page-wrapper)/availability/[schedule]/page.tsx",
  "apps/web/app/(use-page-wrapper)/availability/troubleshoot/page.tsx",
  "apps/web/app/(use-page-wrapper)/settings/(settings-layout)/my-account/out-of-office/page.tsx",
];

describe("the six Cal pages call the guard after their session read", () => {
  it.each(PAGES)("%s", (file) => {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    expect(source).toContain('import { redirectIfCalScreensHidden } from "@lib/flowko/calScreensPage";');
    const sessionRead = source.indexOf("await getServerSession(");
    const loginRedirect = source.indexOf('redirect("/auth/login")');
    const guard = source.indexOf("await redirectIfCalScreensHidden(session.user.id);");
    expect(sessionRead).toBeGreaterThan(-1);
    expect(loginRedirect).toBeGreaterThan(sessionRead);
    expect(guard).toBeGreaterThan(loginRedirect);
    // exactly one call, not inside a try block
    expect(source.match(/redirectIfCalScreensHidden\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/try\s*\{[^}]*redirectIfCalScreensHidden/);
  });
});

// Flowko U28: the same redirect above the loading boundary. A page's loading.tsx shows its skeleton before the page
// body runs, so the page-level call alone flashes the Cal screen; a segment layout runs first.
const LAYOUTS = [
  "apps/web/app/(use-page-wrapper)/(main-nav)/event-types/layout.tsx",
  "apps/web/app/(use-page-wrapper)/(main-nav)/availability/layout.tsx",
  "apps/web/app/(use-page-wrapper)/event-types/[type]/layout.tsx",
  "apps/web/app/(use-page-wrapper)/availability/[schedule]/layout.tsx",
];

describe("the four Cal segment layouts call the guard after their session read (U28)", () => {
  it.each(LAYOUTS)("%s", (file) => {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    expect(source).toContain('import { redirectIfCalScreensHidden } from "@lib/flowko/calScreensPage";');
    const sessionRead = source.indexOf("await getServerSession(");
    const loginRedirect = source.indexOf('redirect("/auth/login")');
    const guard = source.indexOf("await redirectIfCalScreensHidden(session.user.id);");
    expect(source).toMatch(/export default async function \w+\(/);
    expect(sessionRead).toBeGreaterThan(-1);
    expect(loginRedirect).toBeGreaterThan(sessionRead);
    expect(guard).toBeGreaterThan(loginRedirect);
    expect(source.match(/redirectIfCalScreensHidden\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\btry\s*\{/);
    expect(source).toContain("<>{children}</>");
  });
});
