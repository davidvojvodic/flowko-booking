/**
 * Flowko (U8e): two probes an anonymous booker could send to /api/book/event, found by the U8 re-attack.
 * - A `user` list with "+" next to a stored event type's id counted as a dynamic group booking, so the
 *   organizer's default conferencing link replaced the event type's own location, and a dry run returned it.
 * - A dry run answered 409 booking_already_exists_error exactly when the given e-mail had a PENDING booking at
 *   that time, which the public slots don't show (a pending booking leaves its slot free unless the event
 *   type blocks it), so anyone could ask whether a named person has an unconfirmed appointment, silently.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import {
  createBookingScenario,
  getBooker,
  getGoogleCalendarCredential,
  getOrganizer,
  getScenarioData,
  mockCalendarToHaveNoBusySlots,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getMockRequestDataForBooking } from "@calcom/testing/lib/bookingScenario/getMockRequestDataForBooking";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";

import { describe, expect, test } from "vitest";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { BookingStatus } from "@calcom/prisma/enums";

import { getNewBookingHandler } from "./getNewBookingHandler";

const IN_PERSON = { type: "inPerson", address: "Slovenska 1, Ljubljana" };
const SECRET_ROOM = "https://whereby.com/secret-room";

describe("U8e: anonymous probes of /api/book/event", () => {
  setupAndTeardown();

  const organizer = getOrganizer({
    name: "Organizer",
    email: "organizer@example.com",
    id: 101,
    schedules: [TestData.schedules.IstWorkHours],
    credentials: [getGoogleCalendarCredential()],
    selectedCalendars: [TestData.selectedCalendars.google],
    metadata: { defaultConferencingApp: { appSlug: "whereby", appLink: SECRET_ROOM } },
  });

  async function setUp({ requiresConfirmation = false }: { requiresConfirmation?: boolean } = {}) {
    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slotInterval: 30,
            length: 30,
            users: [{ id: 101 }],
            locations: [IN_PERSON],
            requiresConfirmation,
          },
        ],
        organizer,
        apps: [TestData.apps["google-calendar"], TestData.apps["daily-video"]],
      })
    );
    await mockCalendarToHaveNoBusySlots("googlecalendar", { create: { id: "MOCKED_GOOGLE_CALENDAR_EVENT_ID" } });
  }

  const requestFor = (email: string, extra: Record<string, unknown> = {}) =>
    getMockRequestDataForBooking({
      data: {
        eventTypeId: 1,
        user: organizer.username,
        responses: { email, name: "Booker" },
        ...extra,
      },
    });

  describe("a dynamic `user` list with a stored event type", () => {
    test("keeps the event type's location and never hands out the organizer's default link", async () => {
      const handleNewBooking = getNewBookingHandler();
      await setUp();

      const dryRun = await handleNewBooking({
        bookingData: requestFor("booker@example.com", {
          user: `${organizer.username}+someone`,
          _isDryRun: true,
        }),
      });
      expect(dryRun.isDryRun).toBe(true);
      expect(dryRun.location).toBe(IN_PERSON.address);
      expect(JSON.stringify(dryRun)).not.toContain(SECRET_ROOM);

      await handleNewBooking({
        bookingData: requestFor("booker@example.com", { user: `${organizer.username}+someone` }),
      });
      const [stored] = await prismaMock.booking.findMany();
      expect(stored.location).toBe(IN_PERSON.address);
    });
  });

  describe("a dry run at a slot where the e-mail has a pending booking", () => {
    const victim = getBooker({ email: "victim@example.com", name: "Victim" });

    async function withPendingBookingOfVictim() {
      const handleNewBooking = getNewBookingHandler();
      await setUp({ requiresConfirmation: true });
      const pending = await handleNewBooking({ bookingData: requestFor(victim.email) });
      expect(pending.status).toBe(BookingStatus.PENDING);
      return { handleNewBooking, pending };
    }

    test("answers the same for the victim's e-mail as for anyone else's, and writes nothing", async () => {
      const { handleNewBooking } = await withPendingBookingOfVictim();

      const probeVictim = await handleNewBooking({
        bookingData: requestFor(victim.email, { _isDryRun: true }),
      });
      const probeOther = await handleNewBooking({
        bookingData: requestFor("someone-else@example.com", { _isDryRun: true }),
      });

      for (const probe of [probeVictim, probeOther]) expect(probe.isDryRun).toBe(true);
      expect(Object.keys(probeVictim).sort()).toEqual(Object.keys(probeOther).sort());
      expect(probeVictim.uid).toBe(probeOther.uid);
      expect(probeVictim.status).toBe(probeOther.status);
      expect(await prismaMock.booking.findMany()).toHaveLength(1);
    });

    test("still refuses a real duplicate request with 409 and creates no second booking", async () => {
      const { handleNewBooking } = await withPendingBookingOfVictim();

      await expect(handleNewBooking({ bookingData: requestFor(victim.email) })).rejects.toThrow(
        ErrorCode.BookingAlreadyExists
      );
      expect(await prismaMock.booking.findMany()).toHaveLength(1);
    });

    test("still gives the organizer the existing booking, dry run or not", async () => {
      const { handleNewBooking, pending } = await withPendingBookingOfVictim();

      const dryRun = await handleNewBooking({
        bookingData: requestFor(victim.email, { _isDryRun: true }),
        userId: organizer.id,
      });
      expect(dryRun.id).toBe(pending.id);
      expect(dryRun.uid).toBe(pending.uid);
    });
  });
});
