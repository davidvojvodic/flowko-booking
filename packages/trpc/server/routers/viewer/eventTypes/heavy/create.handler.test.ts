import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { Prisma } from "@calcom/prisma/client";

import { createHandler } from "./create.handler";
import type { TCreateInputSchema } from "./create.schema";

const { mockCreate, mockGetDefaultLocations } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetDefaultLocations: vi.fn(),
}));

vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository", () => ({
  EventTypeRepository: vi.fn(function () {
    return { create: mockCreate };
  }),
}));

vi.mock("@calcom/app-store/_utils/getDefaultLocations", () => ({
  getDefaultLocations: mockGetDefaultLocations,
}));

type CreateOptions = Parameters<typeof createHandler>[0];

const ctx = {
  user: {
    id: 1,
    role: "USER",
    organizationId: null,
    organization: { isOrgAdmin: false },
    profile: { id: 1 },
    metadata: {},
    email: "owner@example.com",
  },
  prisma: prismaMock,
} as unknown as CreateOptions["ctx"];

const input: TCreateInputSchema = {
  title: "Haircut",
  slug: "haircut",
  length: 30,
  locations: [{ type: "inPerson", address: "Main street 1" }],
};

// Seated and recurring event types are off on this instance (IS_SEATS_AND_RECURRING_ENABLED). The tRPC input
// schema strips both fields, so these calls stand for API v2, which passes its request body to the handler.
describe("createHandler with seats and recurring events off", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("refuses to create a seated event type", async () => {
    await expect(
      createHandler({ ctx, input: { ...input, seatsPerTimeSlot: 5 } as TCreateInputSchema })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.SeatsAndRecurringNotAvailable });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses to create a recurring event type", async () => {
    await expect(
      createHandler({
        ctx,
        input: { ...input, recurringEvent: { freq: 2, count: 10, interval: 1 } } as TCreateInputSchema,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.SeatsAndRecurringNotAvailable });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates an event type that is neither seated nor recurring", async () => {
    mockCreate.mockResolvedValue({ id: 10, slug: "haircut" });

    const result = await createHandler({ ctx, input });

    expect(result.eventType).toEqual({ id: 10, slug: "haircut" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null", null],
    ["Prisma.DbNull", Prisma.DbNull],
    ["Prisma.JsonNull", Prisma.JsonNull],
  ])("creates an event type whose seats and recurring series are set off with %s", async (_kind, off) => {
    mockCreate.mockResolvedValue({ id: 10, slug: "haircut" });

    await createHandler({
      ctx,
      input: { ...input, seatsPerTimeSlot: null, recurringEvent: off } as unknown as TCreateInputSchema,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// An app the admin switched off (App.enabled = false) stays off for event types; only google-calendar is on
describe("createHandler with apps the admin switched off", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ id: 10, slug: "haircut" });
    prismaMock.app.findMany.mockResolvedValue([]);
  });

  it("refuses to turn on a disabled app", async () => {
    await expect(
      createHandler({
        ctx,
        input: { ...input, metadata: { apps: { ga4: { enabled: true, trackingId: "G-TEST" } } } },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a location of a disabled app", async () => {
    await expect(
      createHandler({ ctx, input: { ...input, locations: [{ type: "integrations:google:meet" }] } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates an event type with an enabled app's location", async () => {
    prismaMock.app.findMany.mockResolvedValue([{ slug: "google-meet", dirName: "googlevideo" }] as never);

    await createHandler({ ctx, input: { ...input, locations: [{ type: "integrations:google:meet" }] } });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ locations: [{ type: "integrations:google:meet" }] })
    );
  });

  it("leaves a disabled app out of the default locations", async () => {
    mockGetDefaultLocations.mockResolvedValue([{ type: "integrations:daily" }]);

    await createHandler({ ctx, input: { ...input, locations: undefined } });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ locations: [] }));
  });
});
