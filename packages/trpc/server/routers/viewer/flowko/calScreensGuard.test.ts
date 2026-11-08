// Flowko U27: Cal's event-type, availability, out-of-office and holiday WRITE routes refuse a WORKER or STAFF member
// of a business (D2); the business owner and a user in no business pass through to the handler. Every handler is
// mocked here: this file pins the middleware wiring on each listed procedure. The mirror refusals (everyone,
// the owner included) live in the handlers and are pinned in calScreensGuard.mirror.test.ts.
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCallerFactory } from "../../../trpc";
import { scheduleRouter } from "../availability/schedule/_router";
import { eventTypesRouter as eventTypesLightRouter } from "../eventTypes/_router";
import { eventTypesRouter as eventTypesHeavyRouter } from "../eventTypes/heavy/_router";
import { holidaysRouter } from "../holidays/_router";
import { oooRouter } from "../ooo/_router";
import { FLOWKO_CAL_SCREEN } from "./calScreensGuard";

const mocks = vi.hoisted(() => ({
  getUserSession: vi.fn(),
  handled: vi.fn(),
}));

vi.mock("@calcom/features/auth/lib/userFromSessionUtils", () => ({ getUserSession: mocks.getUserSession }));
vi.mock("../eventTypes/heavy/create.handler", () => ({ createHandler: mocks.handled }));
vi.mock("../eventTypes/heavy/update.handler", () => ({ updateHandler: mocks.handled }));
vi.mock("../eventTypes/heavy/duplicate.handler", () => ({ duplicateHandler: mocks.handled }));
vi.mock("../eventTypes/delete.handler", () => ({ deleteHandler: mocks.handled }));
vi.mock("../eventTypes/bulkUpdateToDefaultLocation.handler", () => ({
  bulkUpdateToDefaultLocationHandler: mocks.handled,
}));
vi.mock("../eventTypes/massApplyHostLocation.handler", () => ({
  massApplyHostLocationHandler: mocks.handled,
}));
vi.mock("../availability/schedule/create.handler", () => ({ createHandler: mocks.handled }));
vi.mock("../availability/schedule/update.handler", () => ({ updateHandler: mocks.handled }));
vi.mock("../availability/schedule/delete.handler", () => ({ deleteHandler: mocks.handled }));
vi.mock("../availability/schedule/duplicate.handler", () => ({ duplicateHandler: mocks.handled }));
vi.mock("../availability/schedule/bulkUpdateDefaultAvailability.handler", () => ({
  bulkUpdateToDefaultAvailabilityHandler: mocks.handled,
}));
vi.mock("../ooo/outOfOfficeCreateOrUpdate.handler", () => ({ outOfOfficeCreateOrUpdate: mocks.handled }));
vi.mock("../ooo/outOfOfficeEntryDelete.handler", () => ({ outOfOfficeEntryDelete: mocks.handled }));
vi.mock("../holidays/updateSettings.handler", () => ({ updateSettingsHandler: mocks.handled }));
vi.mock("../holidays/toggleHoliday.handler", () => ({ toggleHolidayHandler: mocks.handled }));

const ANA = 11; // WORKER of the test business
const STAFF_USER = 13; // STAFF member with a login
const OLGA = 12; // OWNER of the test business
const STRANGER = 14; // in no business
const EVENT_TYPE_ID = 40;

const members: Record<number, { role: string; business: { slug: string } }> = {
  [ANA]: { role: "WORKER", business: { slug: "salon-test" } },
  [STAFF_USER]: { role: "STAFF", business: { slug: "salon-test" } },
  [OLGA]: { role: "OWNER", business: { slug: "salon-test" } },
};

const createEventTypesLight = createCallerFactory(eventTypesLightRouter);
const createEventTypesHeavy = createCallerFactory(eventTypesHeavyRouter);
const createSchedule = createCallerFactory(scheduleRouter);
const createOoo = createCallerFactory(oooRouter);
const createHolidays = createCallerFactory(holidaysRouter);

function ctxFor(userId: number) {
  mocks.getUserSession.mockResolvedValue({
    user: { id: userId, role: "USER", username: `user-${userId}` },
    session: { user: { id: userId }, upId: `usr-${userId}` },
  });
  return { prisma: prismaMock } as unknown as Parameters<typeof createEventTypesLight>[0];
}

type Case = [string, (userId: number) => Promise<unknown>];

const cases: Case[] = [
  [
    "eventTypes.heavy.create",
    (u) =>
      createEventTypesHeavy(ctxFor(u)).create({
        title: "Test",
        slug: "test",
        length: 30,
        hidden: false,
        locations: [],
      }),
  ],
  [
    "eventTypes.heavy.duplicate",
    (u) =>
      createEventTypesHeavy(ctxFor(u)).duplicate({
        id: EVENT_TYPE_ID,
        slug: "copy",
        title: "Copy",
        description: "",
        length: 30,
      }),
  ],
  ["eventTypes.heavy.update", (u) => createEventTypesHeavy(ctxFor(u)).update({ id: EVENT_TYPE_ID })],
  ["eventTypes.delete", (u) => createEventTypesLight(ctxFor(u)).delete({ id: EVENT_TYPE_ID })],
  [
    "eventTypes.bulkUpdateToDefaultLocation",
    (u) => createEventTypesLight(ctxFor(u)).bulkUpdateToDefaultLocation({ eventTypeIds: [EVENT_TYPE_ID] }),
  ],
  [
    "eventTypes.massApplyHostLocation",
    (u) =>
      createEventTypesLight(ctxFor(u)).massApplyHostLocation({
        eventTypeId: EVENT_TYPE_ID,
        locationType: "integrations:daily",
      }),
  ],
  ["availability.schedule.create", (u) => createSchedule(ctxFor(u)).create({ name: "Hours" })],
  ["availability.schedule.update", (u) => createSchedule(ctxFor(u)).update({ scheduleId: 3, name: "Hours" })],
  ["availability.schedule.delete", (u) => createSchedule(ctxFor(u)).delete({ scheduleId: 3 })],
  ["availability.schedule.duplicate", (u) => createSchedule(ctxFor(u)).duplicate({ scheduleId: 3 })],
  [
    "availability.schedule.bulkUpdateToDefaultAvailability",
    (u) => createSchedule(ctxFor(u)).bulkUpdateToDefaultAvailability({ eventTypeIds: [EVENT_TYPE_ID] }),
  ],
  [
    "ooo.outOfOfficeCreateOrUpdate",
    (u) =>
      createOoo(ctxFor(u)).outOfOfficeCreateOrUpdate({
        dateRange: { startDate: new Date("2026-11-10T00:00:00Z"), endDate: new Date("2026-11-11T00:00:00Z") },
        startDateOffset: 0,
        endDateOffset: 0,
        toTeamUserId: null,
        reasonId: 1,
      }),
  ],
  [
    "ooo.outOfOfficeEntryDelete",
    (u) => createOoo(ctxFor(u)).outOfOfficeEntryDelete({ outOfOfficeUid: "ooo-1" }),
  ],
  [
    "holidays.updateSettings",
    (u) => createHolidays(ctxFor(u)).updateSettings({ countryCode: "SI", resetDisabledHolidays: true }),
  ],
  [
    "holidays.toggleHoliday",
    (u) => createHolidays(ctxFor(u)).toggleHoliday({ holidayId: "h-1", enabled: false }),
  ],
];

describe("flowkoCalScreensGuard on Cal's write routes", () => {
  beforeEach(() => {
    mocks.handled.mockReset();
    mocks.handled.mockResolvedValue("handled");
    prismaMock.flowkoBusinessMember.findUnique.mockImplementation((({
      where,
    }: {
      where: { userId: number };
    }) => Promise.resolve(members[where.userId] ?? null)) as never);
    // the event-type PBAC middleware: the caller owns the event type
    prismaMock.eventType.findUnique.mockImplementation((() =>
      Promise.resolve({ id: EVENT_TYPE_ID, userId: 0, teamId: null, users: [], team: null })) as never);
  });

  function ownEventType(userId: number) {
    prismaMock.eventType.findUnique.mockResolvedValue({
      id: EVENT_TYPE_ID,
      userId,
      teamId: null,
      users: [{ id: userId }],
      team: null,
    } as never);
  }

  it.each(cases)("%s refuses a WORKER (Ana) with a code only", async (_name, call) => {
    ownEventType(ANA);

    await expect(call(ANA)).rejects.toMatchObject({ code: "FORBIDDEN", message: FLOWKO_CAL_SCREEN });

    expect(mocks.handled).not.toHaveBeenCalled();
  });

  it.each(cases)("%s refuses a STAFF member", async (_name, call) => {
    ownEventType(STAFF_USER);

    await expect(call(STAFF_USER)).rejects.toMatchObject({ code: "FORBIDDEN", message: FLOWKO_CAL_SCREEN });

    expect(mocks.handled).not.toHaveBeenCalled();
  });

  it.each(cases)("%s lets the business owner (Olga) through to the handler", async (_name, call) => {
    ownEventType(OLGA);

    await expect(call(OLGA)).resolves.toBe("handled");

    expect(mocks.handled).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("%s lets a user in no business through to the handler", async (_name, call) => {
    ownEventType(STRANGER);

    await expect(call(STRANGER)).resolves.toBe("handled");

    expect(mocks.handled).toHaveBeenCalledTimes(1);
  });
});
