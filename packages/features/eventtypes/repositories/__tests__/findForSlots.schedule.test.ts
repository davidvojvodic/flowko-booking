import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { describe, expect, it } from "vitest";

import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";

// Schedule ids are sequential, and before U8c a tenant could bind another tenant's schedule to their own event
// type. Its public slots then traced that tenant's working hours, date overrides and timezone. findForSlots
// ignores such a schedule, so an event type bound to one before the fix falls back to its owner's own schedule
describe("EventTypeRepository.findForSlots with the event type's schedule", () => {
  const OWNER = 1;
  const HOST = 3;

  const schedule = (userId: number) => ({
    id: 50,
    userId,
    availability: [{ date: null, startTime: new Date(0), endTime: new Date(0), days: [1] }],
    timeZone: "Europe/Ljubljana",
  });

  function stored(eventType: { userId: number | null; schedule: ReturnType<typeof schedule> | null }) {
    prismaMock.eventType.findUnique.mockResolvedValue({
      id: 20,
      metadata: null,
      rrSegmentQueryValue: null,
      users: [{ id: OWNER, selectedCalendars: [] }],
      hosts: [{ user: { id: HOST, selectedCalendars: [] } }],
      ...eventType,
    } as never);
  }

  const findForSlots = () => new EventTypeRepository(prismaMock).findForSlots({ id: 20 });

  it("ignores another tenant's schedule", async () => {
    stored({ userId: OWNER, schedule: schedule(2) });

    expect((await findForSlots())?.schedule).toBeNull();
  });

  it("keeps the owner's own schedule, without its userId", async () => {
    stored({ userId: OWNER, schedule: schedule(OWNER) });

    const { userId: _userId, ...ownSchedule } = schedule(OWNER);
    expect((await findForSlots())?.schedule).toEqual(ownSchedule);
  });

  it("keeps a host's schedule", async () => {
    stored({ userId: OWNER, schedule: schedule(HOST) });

    expect((await findForSlots())?.schedule).toMatchObject({ id: 50 });
  });

  it("leaves an event type with no owner (a team event type) as it was", async () => {
    stored({ userId: null, schedule: schedule(2) });

    expect((await findForSlots())?.schedule).toMatchObject({ id: 50 });
  });

  it("returns no schedule when the event type has none", async () => {
    stored({ userId: OWNER, schedule: null });

    expect((await findForSlots())?.schedule).toBeNull();
  });

  it("reads the schedule's owner", async () => {
    stored({ userId: OWNER, schedule: null });

    await findForSlots();

    expect(prismaMock.eventType.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          schedule: { select: expect.objectContaining({ userId: true }) },
        }),
      })
    );
  });
});
