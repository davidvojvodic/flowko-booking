// Flowko U27: a worker mirror (hidden event type + its empty schedule) is refused on Cal's write routes for EVERYONE,
// the business owner included (Task 2 ruling: deleting the mirror's schedule cascades the mirror row and leaves an
// orphan hidden event type with live slots; editing it gives the mirror live slots). Olga (OWNER) drives the REAL
// handlers through the routers; a refusal writes nothing, and the same calls on her ordinary event type and
// schedule keep working. Cal's update service and the app-store bulk helper are mocked so "nothing written" is
// observable. The middleware (non-owner members) is pinned in calScreensGuard.test.ts.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { scheduleRouter } from "../availability/schedule/_router";
import { eventTypesRouter as eventTypesLightRouter } from "../eventTypes/_router";
import { eventTypesRouter as eventTypesHeavyRouter } from "../eventTypes/heavy/_router";
import { FLOWKO_MIRROR_WRITE } from "./calScreensGuard";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  updateSchedule: vi.fn(),
  bulkUpdateEventsToDefaultLocation: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("@calcom/features/schedules/services/ScheduleService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/features/schedules/services/ScheduleService")>()),
  updateSchedule: mocks.updateSchedule,
}));
vi.mock("@calcom/app-store/_utils/bulkUpdateEventsToDefaultLocation", () => ({
  bulkUpdateEventsToDefaultLocation: mocks.bulkUpdateEventsToDefaultLocation,
}));

const OLGA = 12; // OWNER of the test business
const ORDINARY_EVENT_TYPE = 40;
const ORDINARY_SCHEDULE = 3;
const OTHER_SCHEDULE = 1; // Olga's default
const MIRROR_EVENT_TYPE = 50;
const MIRROR_SCHEDULE = 60;

const createEventTypesLight = createCallerFactory(eventTypesLightRouter);
const createEventTypesHeavy = createCallerFactory(eventTypesHeavyRouter);
const createSchedule = createCallerFactory(scheduleRouter);

function ctx() {
  mocks.getUserSession.mockResolvedValue({
    user: {
      id: OLGA,
      role: "USER",
      username: "olga",
      defaultScheduleId: OTHER_SCHEDULE,
      timeZone: "Europe/Ljubljana",
      metadata: {},
    },
    session: { user: { id: OLGA }, upId: `usr-${OLGA}` },
  });
  return { prisma: prismaMock } as unknown as Parameters<typeof createEventTypesLight>[0];
}

const heavy = () => createEventTypesHeavy(ctx());
const light = () => createEventTypesLight(ctx());
const schedules = () => createSchedule(ctx());

const duplicateInput = (id: number) => ({ id, slug: "copy", title: "Copy", description: "", length: 30 });

// A refused call, one per route and mirror id
const mirrorCalls: [string, () => Promise<unknown>][] = [
  ["eventTypes.heavy.update", () => heavy().update({ id: MIRROR_EVENT_TYPE, hidden: false })],
  ["eventTypes.heavy.duplicate", () => heavy().duplicate(duplicateInput(MIRROR_EVENT_TYPE))],
  ["eventTypes.delete", () => light().delete({ id: MIRROR_EVENT_TYPE })],
  [
    "eventTypes.bulkUpdateToDefaultLocation",
    () => light().bulkUpdateToDefaultLocation({ eventTypeIds: [MIRROR_EVENT_TYPE] }),
  ],
  [
    "eventTypes.bulkUpdateToDefaultLocation (mirror among ordinary ids)",
    () => light().bulkUpdateToDefaultLocation({ eventTypeIds: [ORDINARY_EVENT_TYPE, MIRROR_EVENT_TYPE] }),
  ],
  [
    "eventTypes.massApplyHostLocation",
    () =>
      light().massApplyHostLocation({ eventTypeId: MIRROR_EVENT_TYPE, locationType: "integrations:daily" }),
  ],
  [
    "availability.schedule.create with the mirror's eventTypeId",
    () => schedules().create({ name: "Hours", eventTypeId: MIRROR_EVENT_TYPE }),
  ],
  [
    "availability.schedule.update of the mirror's schedule",
    () => schedules().update({ scheduleId: MIRROR_SCHEDULE, name: "Hours" }),
  ],
  [
    "availability.schedule.delete of the mirror's schedule",
    () => schedules().delete({ scheduleId: MIRROR_SCHEDULE }),
  ],
  [
    "availability.schedule.duplicate of the mirror's schedule",
    () => schedules().duplicate({ scheduleId: MIRROR_SCHEDULE }),
  ],
  [
    "availability.schedule.bulkUpdateToDefaultAvailability with the mirror's id",
    () => schedules().bulkUpdateToDefaultAvailability({ eventTypeIds: [MIRROR_EVENT_TYPE] }),
  ],
  [
    "availability.schedule.bulkUpdateToDefaultAvailability (mirror among ordinary ids)",
    () =>
      schedules().bulkUpdateToDefaultAvailability({
        eventTypeIds: [ORDINARY_EVENT_TYPE, MIRROR_EVENT_TYPE],
        selectedDefaultScheduleId: ORDINARY_SCHEDULE,
      }),
  ],
  [
    "availability.schedule.bulkUpdateToDefaultAvailability with the mirror's schedule as the default",
    () =>
      schedules().bulkUpdateToDefaultAvailability({
        eventTypeIds: [ORDINARY_EVENT_TYPE],
        selectedDefaultScheduleId: MIRROR_SCHEDULE,
      }),
  ],
];

function expectNothingWritten() {
  expect(prismaMock.eventType.create).not.toHaveBeenCalled();
  expect(prismaMock.eventType.update).not.toHaveBeenCalled();
  expect(prismaMock.eventType.updateMany).not.toHaveBeenCalled();
  expect(prismaMock.eventType.delete).not.toHaveBeenCalled();
  expect(prismaMock.eventTypeCustomInput.deleteMany).not.toHaveBeenCalled();
  expect(prismaMock.schedule.create).not.toHaveBeenCalled();
  expect(prismaMock.schedule.update).not.toHaveBeenCalled();
  expect(prismaMock.schedule.delete).not.toHaveBeenCalled();
  expect(prismaMock.user.update).not.toHaveBeenCalled();
  expect(prismaMock.host.updateMany).not.toHaveBeenCalled();
  expect(prismaMock.hostLocation.upsert).not.toHaveBeenCalled();
  expect(mocks.updateSchedule).not.toHaveBeenCalled();
  expect(mocks.bulkUpdateEventsToDefaultLocation).not.toHaveBeenCalled();
}

describe("Cal's write routes and the worker mirror", () => {
  beforeEach(() => {
    mocks.updateSchedule.mockReset();
    mocks.bulkUpdateEventsToDefaultLocation.mockReset();
    mocks.updateSchedule.mockResolvedValue({ schedule: { id: ORDINARY_SCHEDULE } });
    mocks.bulkUpdateEventsToDefaultLocation.mockResolvedValue({ count: 1 });
    prismaMock.flowkoBusinessMember.findUnique.mockResolvedValue({
      role: "OWNER",
      business: { slug: "salon-test" },
    } as never);
    prismaMock.flowkoWorkerMirror.findUnique.mockImplementation((({
      where,
    }: {
      where: { eventTypeId?: number; scheduleId?: number };
    }) =>
      Promise.resolve(
        where.eventTypeId === MIRROR_EVENT_TYPE || where.scheduleId === MIRROR_SCHEDULE
          ? { eventTypeId: MIRROR_EVENT_TYPE, scheduleId: MIRROR_SCHEDULE, businessId: 1, memberId: 2 }
          : null
      )) as never);
    // the event-type middleware and the handlers' own ownership reads: everything here is Olga's
    prismaMock.eventType.findUnique.mockImplementation((({ where }: { where: { id: number } }) =>
      Promise.resolve({
        id: where.id,
        userId: OLGA,
        teamId: null,
        users: [{ id: OLGA }],
        team: null,
      })) as never);
    prismaMock.schedule.findUnique.mockImplementation((({ where }: { where: { id: number } }) =>
      Promise.resolve({
        id: where.id,
        userId: OLGA,
        name: "Hours",
        availability: [],
        timeZone: "Europe/Ljubljana",
      })) as never);
    prismaMock.schedule.findFirst.mockResolvedValue({ id: ORDINARY_SCHEDULE } as never);
    prismaMock.schedule.create.mockResolvedValue({ id: 99 } as never);
    prismaMock.schedule.delete.mockResolvedValue({ id: ORDINARY_SCHEDULE } as never);
    prismaMock.eventType.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.eventType.delete.mockResolvedValue({ id: ORDINARY_EVENT_TYPE } as never);
    prismaMock.eventTypeCustomInput.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.host.findMany.mockResolvedValue([]);
  });

  it.each(mirrorCalls)("refuses %s for the owner, with a code only, and writes nothing", async (_n, call) => {
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN", message: FLOWKO_MIRROR_WRITE });

    expectNothingWritten();
  });

  describe("the same calls on Olga's ordinary event type and schedule", () => {
    it("update reaches the update logic", async () => {
      // the handler's first read after the mirror check
      prismaMock.eventType.findUniqueOrThrow.mockRejectedValue(new Error("reached"));

      await expect(heavy().update({ id: ORDINARY_EVENT_TYPE, hidden: false })).rejects.toThrow("reached");

      expect(prismaMock.eventType.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ORDINARY_EVENT_TYPE } })
      );
    });

    it("duplicate reaches the duplicate logic", async () => {
      await heavy()
        .duplicate(duplicateInput(ORDINARY_EVENT_TYPE))
        .catch(() => undefined);

      expect(prismaMock.eventType.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ORDINARY_EVENT_TYPE }, include: expect.anything() })
      );
    });

    it("delete deletes it", async () => {
      await expect(light().delete({ id: ORDINARY_EVENT_TYPE })).resolves.toEqual({ id: ORDINARY_EVENT_TYPE });

      expect(prismaMock.eventType.delete).toHaveBeenCalledWith({ where: { id: ORDINARY_EVENT_TYPE } });
    });

    it("bulkUpdateToDefaultLocation updates it", async () => {
      await light().bulkUpdateToDefaultLocation({ eventTypeIds: [ORDINARY_EVENT_TYPE] });

      expect(mocks.bulkUpdateEventsToDefaultLocation).toHaveBeenCalledWith(
        expect.objectContaining({ eventTypeIds: [ORDINARY_EVENT_TYPE] })
      );
    });

    it("massApplyHostLocation applies to it", async () => {
      await expect(
        light().massApplyHostLocation({
          eventTypeId: ORDINARY_EVENT_TYPE,
          locationType: "integrations:daily",
        })
      ).resolves.toEqual({ success: true, updatedCount: 0 });
    });

    it("schedule.create with her event type's id creates and attaches the schedule", async () => {
      await schedules().create({ name: "Hours", eventTypeId: ORDINARY_EVENT_TYPE });

      expect(prismaMock.schedule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: { connect: { id: ORDINARY_EVENT_TYPE } } }),
      });
    });

    it("schedule.update updates it", async () => {
      await schedules().update({ scheduleId: ORDINARY_SCHEDULE, name: "Hours" });

      expect(mocks.updateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ scheduleId: ORDINARY_SCHEDULE }) })
      );
    });

    it("schedule.delete deletes it", async () => {
      await schedules().delete({ scheduleId: ORDINARY_SCHEDULE });

      expect(prismaMock.schedule.delete).toHaveBeenCalledWith({ where: { id: ORDINARY_SCHEDULE } });
    });

    it("schedule.duplicate duplicates it", async () => {
      await schedules().duplicate({ scheduleId: ORDINARY_SCHEDULE });

      expect(prismaMock.schedule.create).toHaveBeenCalledTimes(1);
    });

    it("bulkUpdateToDefaultAvailability updates it", async () => {
      await schedules().bulkUpdateToDefaultAvailability({
        eventTypeIds: [ORDINARY_EVENT_TYPE],
        selectedDefaultScheduleId: ORDINARY_SCHEDULE,
      });

      expect(prismaMock.eventType.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { scheduleId: ORDINARY_SCHEDULE } })
      );
    });
  });
});
