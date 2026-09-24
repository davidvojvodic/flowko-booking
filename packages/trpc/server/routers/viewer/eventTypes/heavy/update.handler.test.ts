import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { describe, it, expect } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { Prisma } from "@calcom/prisma/client";

import { updateHandler } from "./update.handler";

describe("update.handler", () => {
  describe("bookingFields null to Prisma.DbNull transformation", () => {
    function transformBookingFields(
      bookingFields: null | undefined | Prisma.InputJsonValue
    ): typeof Prisma.DbNull | Prisma.InputJsonValue | undefined {
      return bookingFields === null ? Prisma.DbNull : (bookingFields as Prisma.InputJsonValue | undefined);
    }

    it("should convert null to Prisma.DbNull", () => {
      const result = transformBookingFields(null);
      expect(result).toBe(Prisma.DbNull);
    });

    it("should pass through undefined as-is", () => {
      const result = transformBookingFields(undefined);
      expect(result).toBeUndefined();
    });

    it("should pass through an array of booking fields as-is", () => {
      const bookingFieldsArray = [
        {
          name: "email",
          type: "email",
          label: "Email",
          required: true,
          hidden: false,
        },
        {
          name: "name",
          type: "name",
          label: "Name",
          required: true,
          hidden: false,
        },
      ];

      const result = transformBookingFields(bookingFieldsArray);
      expect(result).toEqual(bookingFieldsArray);
    });

    it("should pass through an empty array as-is", () => {
      const result = transformBookingFields([]);
      expect(result).toEqual([]);
    });

    it("should distinguish between null and empty array", () => {
      const nullResult = transformBookingFields(null);
      const emptyArrayResult = transformBookingFields([]);

      expect(nullResult).toBe(Prisma.DbNull);
      expect(emptyArrayResult).toEqual([]);
      expect(nullResult).not.toEqual(emptyArrayResult);
    });
  });

  // Seated and recurring event types are off on this instance (IS_SEATS_AND_RECURRING_ENABLED)
  describe("with seats and recurring events off", () => {
    const ctx = {
      user: {
        id: 1,
        username: "owner",
        profile: { id: 1 },
        userLevelSelectedCalendars: [],
        organizationId: null,
        email: "owner@example.com",
        locale: "en",
      },
      prisma: prismaMock,
    } as unknown as Parameters<typeof updateHandler>[0]["ctx"];

    it("refuses to turn on seats", async () => {
      await expect(updateHandler({ ctx, input: { id: 1, seatsPerTimeSlot: 5 } })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: ErrorCode.SeatsAndRecurringNotAvailable,
      });

      expect(prismaMock.eventType.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("refuses to make the event type recurring", async () => {
      await expect(
        updateHandler({ ctx, input: { id: 1, recurringEvent: { freq: 2, count: 10, interval: 1 } } })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: ErrorCode.SeatsAndRecurringNotAvailable,
      });

      expect(prismaMock.eventType.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("lets an update turn seats and the recurring series off", async () => {
      prismaMock.eventType.findUniqueOrThrow.mockRejectedValue(new Error("reached the database"));

      await expect(
        updateHandler({ ctx, input: { id: 1, seatsPerTimeSlot: null, recurringEvent: null } })
      ).rejects.toThrow("reached the database");
    });
  });

  // An app the admin switched off (App.enabled = false) stays off for event types; only google-calendar is on
  describe("with apps the admin switched off", () => {
    const ctx = {
      user: {
        id: 1,
        username: "owner",
        profile: { id: 1 },
        userLevelSelectedCalendars: [],
        organizationId: null,
        email: "owner@example.com",
        locale: "en",
      },
      prisma: prismaMock,
    } as unknown as Parameters<typeof updateHandler>[0]["ctx"];

    const ga4On = { apps: { ga4: { enabled: true, trackingId: "G-TEST" } } };
    const meetLocation = { type: "integrations:google:meet" };

    function storedEventType(stored: { metadata?: unknown; locations?: unknown }) {
      prismaMock.eventType.findUniqueOrThrow.mockResolvedValue({
        metadata: null,
        locations: [],
        team: null,
        hosts: [],
        ...stored,
      } as never);
    }

    it("refuses to turn on a disabled app", async () => {
      storedEventType({});
      prismaMock.app.findMany.mockResolvedValue([]);

      await expect(updateHandler({ ctx, input: { id: 1, metadata: ga4On } })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: ErrorCode.AppNotAvailable,
      });

      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("refuses to add a location of a disabled app", async () => {
      storedEventType({ locations: [{ type: "inPerson", address: "Main street 1" }] });
      prismaMock.app.findMany.mockResolvedValue([]);

      await expect(
        updateHandler({
          ctx,
          input: { id: 1, locations: [{ type: "inPerson", address: "Main street 1" }, meetLocation] },
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: ErrorCode.AppNotAvailable });

      expect(prismaMock.app.findMany).toHaveBeenCalledWith({
        where: { enabled: true, OR: [{ dirName: { in: [] } }, { slug: { in: ["google-meet"] } }] },
        select: { slug: true, dirName: true },
      });
      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("lets the owner save an event type that already has a disabled app on", async () => {
      storedEventType({ metadata: ga4On, locations: [meetLocation] });
      prismaMock.hashedLink.findMany.mockRejectedValue(new Error("got past the app check"));

      await expect(
        updateHandler({ ctx, input: { id: 1, metadata: ga4On, locations: [meetLocation] } })
      ).rejects.toThrow("got past the app check");

      expect(prismaMock.app.findMany).not.toHaveBeenCalled();
    });

    it("lets the owner turn a disabled app off", async () => {
      storedEventType({ metadata: ga4On });
      prismaMock.hashedLink.findMany.mockRejectedValue(new Error("got past the app check"));

      await expect(
        updateHandler({ ctx, input: { id: 1, metadata: { apps: { ga4: { enabled: false } } } } })
      ).rejects.toThrow("got past the app check");

      expect(prismaMock.app.findMany).not.toHaveBeenCalled();
    });
  });

  // There are no teams or managed event types on this instance. A parentId naming another tenant's event type
  // made this one its managed child, so that tenant's webhooks fired for bookings here
  describe("with foreign keys the request must not write", () => {
    const ctx = {
      user: {
        id: 1,
        username: "owner",
        profile: { id: 1 },
        userLevelSelectedCalendars: [],
        organizationId: null,
        email: "owner@example.com",
        locale: "en",
      },
      prisma: prismaMock,
    } as unknown as Parameters<typeof updateHandler>[0]["ctx"];

    function storedPersonalEventType() {
      prismaMock.eventType.findUniqueOrThrow.mockResolvedValue({
        title: "Haircut",
        description: null,
        metadata: null,
        locations: [],
        team: null,
        hosts: [],
        children: [],
        hostGroups: [],
        fieldTranslations: [],
        calVideoSettings: null,
      } as never);
    }

    it("does not write parentId, teamId or profileId", async () => {
      storedPersonalEventType();
      prismaMock.hashedLink.findMany.mockResolvedValue([]);
      prismaMock.eventType.update.mockRejectedValue(new Error("reached the update"));

      await expect(
        updateHandler({ ctx, input: { id: 1, hidden: true, parentId: 99, teamId: 7, profileId: 5 } })
      ).rejects.toThrow("reached the update");

      expect(prismaMock.eventType.update).toHaveBeenCalledTimes(1);
      const { data } = prismaMock.eventType.update.mock.calls[0][0];
      expect(data).toMatchObject({ hidden: true });
      expect(data).not.toHaveProperty("parentId");
      expect(data).not.toHaveProperty("parent");
      expect(data).not.toHaveProperty("teamId");
      expect(data).not.toHaveProperty("team");
      expect(data).not.toHaveProperty("profileId");
      expect(data).not.toHaveProperty("profile");
    });

    it("does not let a teamId in the request pass the restriction schedule check", async () => {
      storedPersonalEventType();
      // Another tenant's schedule, whose owner is an accepted member of the team the request names
      prismaMock.schedule.findUnique.mockResolvedValue({ userId: 2 } as never);
      prismaMock.membership.findFirst.mockResolvedValue({ id: 1 } as never);
      prismaMock.hashedLink.findMany.mockResolvedValue([]);
      prismaMock.eventType.update.mockRejectedValue(new Error("reached the update"));

      await expect(
        updateHandler({ ctx, input: { id: 1, teamId: 7, restrictionScheduleId: 50 } })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });
  });

  // Schedule ids are sequential. An event type bound to another tenant's schedule showed that tenant's working
  // hours, date overrides and timezone in its public slots and in availability.user
  describe("with schedules", () => {
    const ctx = {
      user: {
        id: 1,
        username: "owner",
        profile: { id: 1 },
        userLevelSelectedCalendars: [],
        organizationId: null,
        email: "owner@example.com",
        locale: "en",
      },
      prisma: prismaMock,
    } as unknown as Parameters<typeof updateHandler>[0]["ctx"];

    const OWN_SCHEDULE = 10;
    const OTHER_TENANTS_SCHEDULE = 50;

    function storedEventType(team: unknown = null) {
      prismaMock.eventType.findUniqueOrThrow.mockResolvedValue({
        title: "Haircut",
        description: null,
        metadata: null,
        locations: [],
        team,
        hosts: [],
        children: [],
        hostGroups: [],
        fieldTranslations: [],
        calVideoSettings: null,
      } as never);
      prismaMock.schedule.findMany.mockImplementation((async (args: {
        where: { id: { in: number[] } };
      }) =>
        [
          { id: OWN_SCHEDULE, userId: 1 },
          { id: OTHER_TENANTS_SCHEDULE, userId: 2 },
        ].filter((schedule) => args.where.id.in.includes(schedule.id))) as never);
      prismaMock.hashedLink.findMany.mockResolvedValue([]);
      prismaMock.eventType.update.mockRejectedValue(new Error("reached the update"));
    }

    function updateData() {
      expect(prismaMock.eventType.update).toHaveBeenCalledTimes(1);
      return prismaMock.eventType.update.mock.calls[0][0].data;
    }

    it.each([
      ["scheduleId", { scheduleId: OTHER_TENANTS_SCHEDULE }],
      ["schedule", { schedule: OTHER_TENANTS_SCHEDULE }],
      ["instantMeetingScheduleId", { instantMeetingScheduleId: OTHER_TENANTS_SCHEDULE }],
      ["instantMeetingSchedule", { instantMeetingSchedule: OTHER_TENANTS_SCHEDULE }],
    ])("refuses another tenant's schedule in %s", async (_field, fields) => {
      storedEventType();

      await expect(updateHandler({ ctx, input: { id: 1, ...fields } })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("refuses a schedule id that does not exist the same way", async () => {
      storedEventType();

      await expect(updateHandler({ ctx, input: { id: 1, scheduleId: 999 } })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("refuses before anything is written", async () => {
      storedEventType();
      prismaMock.hostGroup.findMany.mockResolvedValue([]);

      await expect(
        updateHandler({
          ctx,
          input: { id: 1, schedule: OTHER_TENANTS_SCHEDULE, hostGroups: [] },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("never lets the scalar alias through when the relation-style field names an own schedule", async () => {
      storedEventType();

      await expect(
        updateHandler({ ctx, input: { id: 1, schedule: OWN_SCHEDULE, scheduleId: OTHER_TENANTS_SCHEDULE } })
      ).rejects.toThrow("reached the update");

      const data = updateData();
      expect(data.schedule).toEqual({ connect: { id: OWN_SCHEDULE } });
      expect(data).not.toHaveProperty("scheduleId");
    });

    it("connects the owner's own schedule from schedule or scheduleId", async () => {
      storedEventType();
      await expect(updateHandler({ ctx, input: { id: 1, schedule: OWN_SCHEDULE } })).rejects.toThrow(
        "reached the update"
      );
      expect(updateData().schedule).toEqual({ connect: { id: OWN_SCHEDULE } });

      prismaMock.eventType.update.mockClear();
      await expect(updateHandler({ ctx, input: { id: 1, scheduleId: OWN_SCHEDULE } })).rejects.toThrow(
        "reached the update"
      );
      const data = updateData();
      expect(data.schedule).toEqual({ connect: { id: OWN_SCHEDULE } });
      expect(data).not.toHaveProperty("scheduleId");
    });

    it("connects the owner's own instant meeting schedule", async () => {
      storedEventType();

      await expect(
        updateHandler({ ctx, input: { id: 1, instantMeetingScheduleId: OWN_SCHEDULE } })
      ).rejects.toThrow("reached the update");

      const data = updateData();
      expect(data.instantMeetingSchedule).toEqual({ connect: { id: OWN_SCHEDULE } });
      expect(data).not.toHaveProperty("instantMeetingScheduleId");
    });

    it.each([
      ["schedule: null", { schedule: null }],
      ["schedule: 0", { schedule: 0 }],
      ["scheduleId: null", { scheduleId: null }],
    ])("still unsets the schedule with %s", async (_label, fields) => {
      storedEventType();

      await expect(updateHandler({ ctx, input: { id: 1, ...fields } })).rejects.toThrow("reached the update");

      const data = updateData();
      expect(data.schedule).toEqual({ disconnect: true });
      expect(data).not.toHaveProperty("scheduleId");
      expect(prismaMock.schedule.findMany).not.toHaveBeenCalled();
    });

    it("refuses a host schedule that is not that host's own", async () => {
      storedEventType({ id: 7, parentId: null, rrTimestampBasis: null, members: [] });
      prismaMock.membership.findMany.mockResolvedValue([{ userId: 1 }] as never);

      await expect(
        updateHandler({
          ctx,
          input: { id: 1, hosts: [{ userId: 1, scheduleId: OTHER_TENANTS_SCHEDULE }] },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(prismaMock.eventType.update).not.toHaveBeenCalled();
    });

    it("keeps a host's own schedule", async () => {
      storedEventType({ id: 7, parentId: null, rrTimestampBasis: null, members: [] });
      prismaMock.membership.findMany.mockResolvedValue([{ userId: 1 }] as never);

      await expect(
        updateHandler({ ctx, input: { id: 1, hosts: [{ userId: 1, scheduleId: OWN_SCHEDULE }] } })
      ).rejects.toThrow("reached the update");

      expect(updateData().hosts.create).toEqual([expect.objectContaining({ scheduleId: OWN_SCHEDULE })]);
    });
  });
});
