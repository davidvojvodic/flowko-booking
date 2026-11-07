// @vitest-environment node
// Flowko U27: the worker mirror table and the three deferred indexes on a real database (prismock ignores unique
// keys and foreign-key actions). Proves: one mirror row per member, per event type and per schedule (P2002);
// deleting the event type, the schedule or the member deletes the mirror row; the table index and the two
// indexes on FlowkoBookingStep and FlowkoBookingAction exist. Business and member are created with separate
// create calls (a nested member create trips the Teams guard's P2). Runs only with VITEST_MODE=integration
// against the throwaway DB.

import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function plainUser(name: string): Promise<number> {
  const username = `${name}-${RUN}`;
  const user = await prisma.user.create({
    data: { email: `${username}@example.com`, username, name },
    select: { id: true },
  });
  return user.id;
}

async function newBusiness(label: string): Promise<number> {
  const business = await prisma.flowkoBusiness.create({
    data: { name: `Salon ${label}`, slug: `${label}-${RUN}`, openingHours: {} },
    select: { id: true },
  });
  return business.id;
}

async function newMember(businessId: number, label: string, userId: number): Promise<number> {
  const member = await prisma.flowkoBusinessMember.create({
    data: { businessId, userId, role: FlowkoBusinessRole.OWNER, displayName: label },
    select: { id: true },
  });
  return member.id;
}

async function newEventType(label: string, userId: number): Promise<number> {
  const eventType = await prisma.eventType.create({
    data: { title: label, slug: `${label}-${RUN}`, length: 15, hidden: true, userId },
    select: { id: true },
  });
  return eventType.id;
}

async function newSchedule(label: string, userId: number): Promise<number> {
  const schedule = await prisma.schedule.create({
    data: { name: label, userId },
    select: { id: true },
  });
  return schedule.id;
}

async function mirrorFor(label: string) {
  const userId = await plainUser(label);
  const businessId = await newBusiness(label);
  const memberId = await newMember(businessId, label, userId);
  const eventTypeId = await newEventType(label, userId);
  const scheduleId = await newSchedule(label, userId);
  return { userId, businessId, memberId, eventTypeId, scheduleId };
}

describe("U27 worker mirror schema on a real database", () => {
  let base: Awaited<ReturnType<typeof mirrorFor>>;

  beforeAll(async () => {
    base = await mirrorFor("mirror-base");
    await prisma.flowkoWorkerMirror.create({
      data: {
        businessId: base.businessId,
        memberId: base.memberId,
        eventTypeId: base.eventTypeId,
        scheduleId: base.scheduleId,
      },
    });
  });

  it("creates a mirror row with a creation time", async () => {
    const row = await prisma.flowkoWorkerMirror.findUniqueOrThrow({ where: { memberId: base.memberId } });
    expect(row).toMatchObject({
      businessId: base.businessId,
      memberId: base.memberId,
      eventTypeId: base.eventTypeId,
      scheduleId: base.scheduleId,
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("one mirror per member, per event type and per schedule (P2002)", async () => {
    const other = await mirrorFor("mirror-dup");
    const mirror = (over: Partial<typeof other>) => ({
      businessId: other.businessId,
      memberId: other.memberId,
      eventTypeId: other.eventTypeId,
      scheduleId: other.scheduleId,
      ...over,
    });
    await expect(
      prisma.flowkoWorkerMirror.create({ data: mirror({ memberId: base.memberId }) })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.flowkoWorkerMirror.create({ data: mirror({ eventTypeId: base.eventTypeId }) })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.flowkoWorkerMirror.create({ data: mirror({ scheduleId: base.scheduleId }) })
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.flowkoWorkerMirror.count({ where: { businessId: other.businessId } })).toBe(0);
  });

  it("deleting the event type deletes the mirror row", async () => {
    const m = await mirrorFor("mirror-et");
    await prisma.flowkoWorkerMirror.create({ data: { ...pick(m) } });
    await prisma.eventType.delete({ where: { id: m.eventTypeId } });
    expect(await prisma.flowkoWorkerMirror.count({ where: { memberId: m.memberId } })).toBe(0);
  });

  it("deleting the schedule deletes the mirror row", async () => {
    const m = await mirrorFor("mirror-sch");
    await prisma.flowkoWorkerMirror.create({ data: { ...pick(m) } });
    await prisma.schedule.delete({ where: { id: m.scheduleId } });
    expect(await prisma.flowkoWorkerMirror.count({ where: { memberId: m.memberId } })).toBe(0);
  });

  it("deleting the member deletes the mirror row", async () => {
    const m = await mirrorFor("mirror-mem");
    await prisma.flowkoWorkerMirror.create({ data: { ...pick(m) } });
    await prisma.flowkoBusinessMember.delete({ where: { id: m.memberId } });
    expect(await prisma.flowkoWorkerMirror.count({ where: { eventTypeId: m.eventTypeId } })).toBe(0);
    // The event type and schedule are not the member's to delete: they stay until their own owner goes.
    expect(await prisma.eventType.count({ where: { id: m.eventTypeId } })).toBe(1);
    expect(await prisma.schedule.count({ where: { id: m.scheduleId } })).toBe(1);
  });

  it("the mirror index and the three deferred indexes exist", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname::text AS indexname FROM pg_indexes
      WHERE indexname IN (
        'FlowkoWorkerMirror_businessId_idx',
        'FlowkoBookingStep_serviceId_idx',
        'FlowkoBookingAction_userId_idx',
        'FlowkoBookingAction_actorMemberId_idx'
      )`;
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      "FlowkoBookingAction_actorMemberId_idx",
      "FlowkoBookingAction_userId_idx",
      "FlowkoBookingStep_serviceId_idx",
      "FlowkoWorkerMirror_businessId_idx",
    ]);
  });
});

function pick(m: Awaited<ReturnType<typeof mirrorFor>>) {
  return {
    businessId: m.businessId,
    memberId: m.memberId,
    eventTypeId: m.eventTypeId,
    scheduleId: m.scheduleId,
  };
}
