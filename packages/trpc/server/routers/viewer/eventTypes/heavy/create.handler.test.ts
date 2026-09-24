import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { Prisma } from "@calcom/prisma/client";
import type { NextApiRequest } from "next";

import { createHandler } from "./create.handler";
import type { TCreateInputSchema } from "./create.schema";

const { mockCreate, mockGetDefaultLocations, getToken } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetDefaultLocations: vi.fn(),
  getToken: vi.fn(),
}));

// The session's JWT, which carries the role validateRole gave it at sign-in
vi.mock("next-auth/jwt", () => ({ getToken }));

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

// There are no teams on this instance and the PBAC service in the handler is a stub that allows everyone, so a
// tenant could otherwise create an event type inside any team by naming its id
describe("createHandler with a team", () => {
  const teamInput = { ...input, teamId: 7, schedulingType: "COLLECTIVE" } as TCreateInputSchema;

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ id: 10, slug: "haircut" });
    prismaMock.app.findMany.mockResolvedValue([]);
  });

  it("refuses a team the user is not an admin or owner of", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);

    await expect(createHandler({ ctx, input: teamInput })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({
      where: { teamId: 7, userId: 1, accepted: true, role: { in: ["ADMIN", "OWNER"] } },
      select: { id: true },
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the event type for an accepted admin or owner of the team", async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ id: 3 } as never);

    await createHandler({ ctx, input: teamInput });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ team: { connect: { id: 7 } } }));
  });

  function adminCtx(twoFactorEnabled: boolean, signInRole: string) {
    getToken.mockResolvedValue({ role: signInRole });
    return {
      ...ctx,
      user: { ...ctx.user, role: "ADMIN", twoFactorEnabled, identityProvider: "CAL" },
      req: {} as NextApiRequest,
    } as unknown as CreateOptions["ctx"];
  }

  it("lets an active system admin create a team event type", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);

    await createHandler({ ctx: adminCtx(true, "ADMIN"), input: teamInput });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ team: { connect: { id: 7 } } }));
  });

  // An ADMIN without 2FA or a strong password is an INACTIVE_ADMIN at sign-in, but the database still says ADMIN
  it.each([
    ["with two-factor authentication off", false, "INACTIVE_ADMIN"],
    ["whose session signed in as INACTIVE_ADMIN", true, "INACTIVE_ADMIN"],
  ])("refuses a team event type to an admin %s", async (_kind, twoFactorEnabled, signInRole) => {
    prismaMock.membership.findFirst.mockResolvedValue(null);

    await expect(
      createHandler({ ctx: adminCtx(twoFactorEnabled, signInRole), input: teamInput })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a team event type to an admin without a session request", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);
    const { req: _req, ...ctxWithoutReq } = adminCtx(true, "ADMIN") as CreateOptions["ctx"] & { req: unknown };

    await expect(
      createHandler({ ctx: ctxWithoutReq as CreateOptions["ctx"], input: teamInput })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// Schedule ids are sequential. A new event type bound to another tenant's schedule showed that tenant's working
// hours, date overrides and timezone in its public slots
describe("createHandler with a schedule", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ id: 10, slug: "haircut" });
    prismaMock.app.findMany.mockResolvedValue([]);
  });

  it("refuses another tenant's schedule", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([{ id: 50, userId: 2 }] as never);

    await expect(createHandler({ ctx, input: { ...input, scheduleId: 50 } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(prismaMock.schedule.findMany).toHaveBeenCalledWith({
      where: { id: { in: [50] } },
      select: { id: true, userId: true },
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a schedule id that does not exist the same way", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([]);

    await expect(createHandler({ ctx, input: { ...input, scheduleId: 999 } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("connects the owner's own schedule", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([{ id: 10, userId: 1 }] as never);

    await createHandler({ ctx, input: { ...input, scheduleId: 10 } });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ schedule: { connect: { id: 10 } } }));
  });

  it("creates an event type without a schedule with no schedule lookup", async () => {
    await createHandler({ ctx, input });

    expect(prismaMock.schedule.findMany).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ schedule: undefined }));
  });
});
