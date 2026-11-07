// @vitest-environment node
// Flowko U27: Cal's own slot engine on a worker mirror, on a real database. Ana is a real worker with a Mon-Fri
// 09-17 default schedule and one ordinary event type. ensureWorkerMirror runs inside a transaction (as the booking
// writer will call it); then Cal's getAvailableSlots offers NO slot on the mirror for Mon 16 - Fri 20 Nov 2026,
// while the same call on Ana's ordinary event type offers slots (positive control: the default schedule is live,
// so the mirror's empty result is its empty schedule's doing). findForSlots keeps the mirror's own empty schedule
// (its owner is the event type's owner). Also checks on Postgres what prismock cannot: the mirror's users link,
// and that a second call inside another transaction reuses the rows. Only Date is faked (NOW = Mon 9 Nov 07:00
// Ljubljana) so the window stays in the future. Runs only with VITEST_MODE=integration against the throwaway DB.

import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import prisma from "@calcom/prisma";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { addLoginMember, createBusiness } from "./business";
import { ensureWorkerMirror, type WorkerMirror } from "./mirror";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date("2026-11-09T06:00:00Z");
const TIME_ZONE = "Europe/Ljubljana";
// Mon 2026-11-16 00:00 and Fri 2026-11-20 23:59:59.999 in Ljubljana (CET, UTC+1).
const WINDOW = { startTime: "2026-11-15T23:00:00.000Z", endTime: "2026-11-20T22:59:59.999Z" };

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

async function realUser(name: string): Promise<number> {
  const username = `${name.toLowerCase()}-${RUN}`;
  const user = await prisma.user.create({
    data: {
      email: `${username}@example.com`,
      username,
      name,
      timeZone: TIME_ZONE,
      completedOnboarding: true,
      emailVerified: new Date(),
    },
    select: { id: true },
  });
  return user.id;
}

async function slotsFor(eventTypeId: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  try {
    return await getAvailableSlotsService().getAvailableSlots({
      input: {
        eventTypeId,
        eventTypeSlug: "",
        startTime: WINDOW.startTime,
        endTime: WINDOW.endTime,
        timeZone: TIME_ZONE,
        isTeamEvent: false,
        orgSlug: null,
      },
    });
  } finally {
    vi.useRealTimers();
  }
}

describe("U27 worker mirror: Cal's slot engine offers nothing on a mirror", () => {
  let ana: number;
  let ordinaryEventTypeId: number;
  let mirror: WorkerMirror;

  beforeAll(async () => {
    const olga = await realUser("Olga");
    const { businessId } = await createBusiness(prisma, {
      ownerUserId: olga,
      name: `Salon Mirror ${RUN}`,
      slug: `salon-mirror-${RUN}`,
      templateId: "hair-salon",
    });

    ana = await realUser("Ana");
    const workHours = await prisma.schedule.create({
      data: {
        user: { connect: { id: ana } },
        name: "Delovni čas",
        timeZone: TIME_ZONE,
        availability: {
          create: [{ days: [1, 2, 3, 4, 5], startTime: time("09:00"), endTime: time("17:00") }],
        },
      },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: ana }, data: { defaultScheduleId: workHours.id } });
    const ordinary = await prisma.eventType.create({
      data: {
        title: "Posvet",
        slug: `posvet-${RUN}`,
        length: 30,
        owner: { connect: { id: ana } },
        users: { connect: [{ id: ana }] },
      },
      select: { id: true },
    });
    ordinaryEventTypeId = ordinary.id;

    const { memberId } = await addLoginMember(prisma, businessId, ana, FlowkoBusinessRole.WORKER);
    mirror = await prisma.$transaction((tx) => ensureWorkerMirror(tx, memberId));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("positive control: Ana's ordinary event type gets slots from her default schedule", async () => {
    const result = await slotsFor(ordinaryEventTypeId);
    const all = Object.values(result.slots).flat();
    expect(all.length).toBeGreaterThan(0);
  });

  it("the mirror event type gets no slot at all", async () => {
    const result = await slotsFor(mirror.eventTypeId);
    expect(result.slots).toEqual({});
  });

  it("findForSlots keeps the mirror's own empty schedule", async () => {
    const eventType = await new EventTypeRepository(prisma).findForSlots({ id: mirror.eventTypeId });
    expect(eventType?.schedule).not.toBeNull();
    expect(eventType?.schedule?.id).toBe(mirror.scheduleId);
    expect(eventType?.schedule?.availability).toEqual([]);
    expect(eventType?.users.map((u) => u.id)).toEqual([ana]);
  });

  it("the mirror links Ana as its only user, and a second call in another transaction reuses the rows", async () => {
    const eventType = await prisma.eventType.findUniqueOrThrow({
      where: { id: mirror.eventTypeId },
      select: { userId: true, users: { select: { id: true } }, hosts: { select: { userId: true } } },
    });
    expect(eventType.userId).toBe(ana);
    expect(eventType.users.map((u) => u.id)).toEqual([ana]);
    expect(eventType.hosts).toEqual([]);

    const again = await prisma.$transaction((tx) => ensureWorkerMirror(tx, mirror.memberId));
    expect(again).toEqual(mirror);
    expect(await prisma.eventType.count({ where: { userId: ana } })).toBe(2);
    expect(await prisma.schedule.count({ where: { userId: ana } })).toBe(2);
  });
});
