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
});
