import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { connectedCalendarsHandler } from "./connectedCalendars.handler";

const { getConnectedDestinationCalendarsAndEnsureDefaultsInDb } = vi.hoisted(() => ({
  getConnectedDestinationCalendarsAndEnsureDefaultsInDb: vi.fn(),
}));

vi.mock("@calcom/features/calendars/lib/getConnectedDestinationCalendars", () => ({
  getConnectedDestinationCalendarsAndEnsureDefaultsInDb,
}));

const OWN_EVENT_TYPE_ID = 21;
const eventTypeFindFirst = vi.fn();
const prisma = { eventType: { findFirst: eventTypeFindFirst } } as unknown as PrismaClient;
const user = { id: 1 } as NonNullable<TrpcSessionUser>;

describe("connectedCalendarsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectedDestinationCalendarsAndEnsureDefaultsInDb.mockResolvedValue({
      connectedCalendars: [],
      destinationCalendar: null,
    });
    eventTypeFindFirst.mockImplementation(({ where }: { where: { id: number; userId: number } }) =>
      Promise.resolve(where.id === OWN_EVENT_TYPE_ID && where.userId === user.id ? { id: where.id } : null)
    );
  });

  it("lists the caller's calendars without an event type", async () => {
    await connectedCalendarsHandler({ ctx: { user, prisma }, input: undefined });

    expect(eventTypeFindFirst).not.toHaveBeenCalled();
    expect(getConnectedDestinationCalendarsAndEnsureDefaultsInDb).toHaveBeenCalledWith(
      expect.objectContaining({ user, eventTypeId: null })
    );
  });

  it("lists the calendars for the caller's own event type", async () => {
    await connectedCalendarsHandler({ ctx: { user, prisma }, input: { eventTypeId: OWN_EVENT_TYPE_ID } });

    expect(eventTypeFindFirst).toHaveBeenCalledWith({
      where: { id: OWN_EVENT_TYPE_ID, userId: user.id },
      select: { id: true },
    });
    expect(getConnectedDestinationCalendarsAndEnsureDefaultsInDb).toHaveBeenCalledWith(
      expect.objectContaining({ eventTypeId: OWN_EVENT_TYPE_ID })
    );
  });

  it("refuses another tenant's event type before writing a selected calendar for it", async () => {
    await expect(
      connectedCalendarsHandler({ ctx: { user, prisma }, input: { onboarding: true, eventTypeId: 77 } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(getConnectedDestinationCalendarsAndEnsureDefaultsInDb).not.toHaveBeenCalled();
  });
});
