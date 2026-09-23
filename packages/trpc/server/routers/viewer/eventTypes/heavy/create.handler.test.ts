import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";

import { createHandler } from "./create.handler";
import type { TCreateInputSchema } from "./create.schema";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository", () => ({
  EventTypeRepository: vi.fn(function () {
    return { create: mockCreate };
  }),
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
});
