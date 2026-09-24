import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { TRPCError } from "@trpc/server";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { duplicateHandler } from "./duplicate.handler";

vi.mock("@calcom/prisma", () => ({
  default: prismaMock,
}));
vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository");

describe("duplicateHandler", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = { user: { id: 1, profile: { id: 1 } } } as any;
  const input = {
    id: 123,
    slug: "test-event",
    title: "Test",
    description: "Test",
    length: 30,
    teamId: null,
  };
  const eventType = { id: 123, userId: 1, teamId: null, users: [{ id: 1 }] };

  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.eventType.findUnique.mockResolvedValue(eventType);
  });

  it("should throw INTERNAL_SERVER_ERROR in case of unique constraint violation", async () => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return {
        create: vi.fn().mockRejectedValue(
          new PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "mockedVersion",
          })
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });

    await expect(duplicateHandler({ ctx, input })).rejects.toThrow(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Error duplicating event type PrismaClientKnownRequestError: Unique constraint failed",
      })
    );
  });

  // Seated and recurring event types are off on this instance (IS_SEATS_AND_RECURRING_ENABLED), so one made
  // seated or recurring before, or outside the event type handlers, is not copied
  it.each([
    ["seated", { seatsPerTimeSlot: 5, recurringEvent: null }],
    ["recurring", { seatsPerTimeSlot: null, recurringEvent: { freq: 2, count: 10, interval: 1 } }],
  ])("should refuse to duplicate a %s event type", async (_kind, seatsAndRecurring) => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    const create = vi.fn();
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create } as unknown as InstanceType<typeof EventTypeRepository>;
    });
    prismaMock.eventType.findUnique.mockResolvedValue({ ...eventType, ...seatsAndRecurring });

    await expect(duplicateHandler({ ctx, input })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: ErrorCode.SeatsAndRecurringNotAvailable,
    });
    expect(create).not.toHaveBeenCalled();
  });

  // The handler copies input.id, so it refuses another tenant's personal event type itself (ET-1 class)
  it("should refuse to duplicate another tenant's personal event type", async () => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    const create = vi.fn();
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create } as unknown as InstanceType<typeof EventTypeRepository>;
    });
    prismaMock.eventType.findUnique.mockResolvedValue({ ...eventType, userId: 2, users: [{ id: 2 }] });

    await expect(duplicateHandler({ ctx, input })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  // A parentId would make the copy a managed child of that event type and pull in the parent's webhooks
  it("should not copy the parentId", async () => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    const create = vi.fn().mockResolvedValue({ id: 456, teamId: null });
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create } as unknown as InstanceType<typeof EventTypeRepository>;
    });
    prismaMock.eventType.findUnique.mockResolvedValue({ ...eventType, parentId: 99, hashedLink: [] });

    await expect(duplicateHandler({ ctx, input })).resolves.toMatchObject({ eventType: { id: 456 } });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).not.toHaveProperty("parentId");
    expect(create.mock.calls[0][0]).not.toHaveProperty("parent");
  });

  // An app the admin switched off (App.enabled = false) stays off for event types, the copy included
  it.each([
    ["a disabled app turned on", { metadata: { apps: { ga4: { enabled: true, trackingId: "G-TEST" } } } }],
    ["a disabled app's location", { locations: [{ type: "integrations:google:meet" }] }],
  ])("should refuse to duplicate an event type with %s", async (_kind, apps) => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    const create = vi.fn();
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create } as unknown as InstanceType<typeof EventTypeRepository>;
    });
    prismaMock.eventType.findUnique.mockResolvedValue({ ...eventType, ...apps });
    prismaMock.app.findMany.mockResolvedValue([]);

    await expect(duplicateHandler({ ctx, input })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: ErrorCode.AppNotAvailable,
    });
    expect(create).not.toHaveBeenCalled();
  });

  // A non-zero price column is legacy stripe data (getEventTypeAppData), and the copy is a new event type, so
  // the price it takes over turns stripe on in it (N2)
  it("should refuse to duplicate an event type with a price while stripe is disabled", async () => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    const create = vi.fn();
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create } as unknown as InstanceType<typeof EventTypeRepository>;
    });
    prismaMock.eventType.findUnique.mockResolvedValue({ ...eventType, price: 5000, currency: "eur" });
    prismaMock.app.findMany.mockResolvedValue([]);

    await expect(duplicateHandler({ ctx, input })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: ErrorCode.AppNotAvailable,
    });
    expect(prismaMock.app.findMany).toHaveBeenCalledWith({
      where: { enabled: true, OR: [{ dirName: { in: ["stripepayment"] } }, { slug: { in: [] } }] },
      select: { slug: true, dirName: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("should still duplicate an event type without a price", async () => {
    const { EventTypeRepository } = await import(
      "@calcom/features/eventtypes/repositories/eventTypeRepository"
    );
    const create = vi.fn().mockResolvedValue({ id: 456, teamId: null });
    vi.mocked(EventTypeRepository).mockImplementation(function () {
      return { create } as unknown as InstanceType<typeof EventTypeRepository>;
    });
    prismaMock.eventType.findUnique.mockResolvedValue({ ...eventType, price: 0, hashedLink: [] });

    await expect(duplicateHandler({ ctx, input })).resolves.toMatchObject({ eventType: { id: 456 } });
    expect(prismaMock.app.findMany).not.toHaveBeenCalled();
  });
});
