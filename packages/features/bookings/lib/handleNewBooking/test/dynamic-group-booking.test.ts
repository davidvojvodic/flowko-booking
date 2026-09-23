/**
 * These tests are integration tests that test the flow from receiving a api/book/event request and then verifying
 * - database entries created in In-MEMORY DB using prismock
 * - emails sent by checking the testEmails global variable
 * - webhooks fired by mocking fetch
 * - APIs of various apps called by mocking those apps' modules
 *
 * They don't intend to test what the apps logic should do, but rather test if the apps are called with the correct data. For testing that, once should write tests within each app.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";
import {
  createBookingScenario,
  getDate,
  TestData,
  getOrganizer,
  getBooker,
  getScenarioData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForDynamicGroupBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import type { Request, Response } from "express";
import type { NextApiRequest, NextApiResponse } from "next";
import { describe, expect } from "vitest";

import { test } from "@calcom/testing/lib/fixtures/fixtures";

import { getNewBookingHandler } from "./getNewBookingHandler";

export type CustomNextApiRequest = NextApiRequest & Request;

export type CustomNextApiResponse = NextApiResponse & Response;
// Local test runs sometime gets too slow
const timeout = process.env.CI ? 5000 : 20000;

// Dynamic group booking is disabled instance-wide (IS_DYNAMIC_GROUP_BOOKING_ENABLED), so a booking
// without an event type must fail even though every user keeps the default allowDynamicBooking=true.
describe("handleNewBooking", () => {
  setupAndTeardown();
  describe("Dynamic Group Booking", () => {
    const setupGroupUsers = async () => {
      const groupUser1 = getOrganizer({
        name: "group-user-1",
        username: "group-user-1",
        email: "group-user-1@example.com",
        id: 101,
        schedules: [TestData.schedules.IstWorkHours],
        credentials: [],
        selectedCalendars: [],
      });

      const groupUser2 = getOrganizer({
        name: "group-user-2",
        username: "group-user-2",
        email: "group-user-2@example.com",
        id: 102,
        schedules: [TestData.schedules.IstWorkHours],
        credentials: [],
        selectedCalendars: [],
      });

      await createBookingScenario(
        getScenarioData({
          eventTypes: [],
          users: [groupUser1, groupUser2],
        })
      );
    };

    const booker = getBooker({
      email: "booker@example.com",
      name: "Booker",
    });

    test(
      `should reject a dynamic group booking even when every user allows dynamic booking`,
      async () => {
        const handleNewBooking = getNewBookingHandler();
        await setupGroupUsers();

        const mockBookingData = getMockRequestDataForDynamicGroupBooking({
          data: {
            start: `${getDate({ dateIncrement: 1 }).dateString}T05:00:00.000Z`,
            end: `${getDate({ dateIncrement: 1 }).dateString}T05:30:00.000Z`,
            eventTypeId: 0,
            eventTypeSlug: "group-user-1+group-user-2",
            user: "group-user-1+group-user-2",
            responses: {
              email: booker.email,
              name: booker.name,
              location: { optionValue: "", value: "New York" },
            },
          },
        });

        await expect(
          async () =>
            await handleNewBooking({
              bookingData: mockBookingData,
            })
        ).rejects.toThrowError("Some of the users in this group do not allow dynamic booking");

        expect(await prismaMock.booking.findMany()).toHaveLength(0);
      },
      timeout
    );

    test(
      `should reject a booking without an event type for a single user`,
      async () => {
        const handleNewBooking = getNewBookingHandler();
        await setupGroupUsers();

        const mockBookingData = getMockRequestDataForDynamicGroupBooking({
          data: {
            start: `${getDate({ dateIncrement: 1 }).dateString}T05:00:00.000Z`,
            end: `${getDate({ dateIncrement: 1 }).dateString}T05:30:00.000Z`,
            eventTypeId: 0,
            eventTypeSlug: "dynamic",
            user: "group-user-1",
            responses: {
              email: booker.email,
              name: booker.name,
              location: { optionValue: "", value: "New York" },
            },
          },
        });

        await expect(
          async () =>
            await handleNewBooking({
              bookingData: mockBookingData,
            })
        ).rejects.toThrowError("Some of the users in this group do not allow dynamic booking");

        expect(await prismaMock.booking.findMany()).toHaveLength(0);
      },
      timeout
    );
  });
});
