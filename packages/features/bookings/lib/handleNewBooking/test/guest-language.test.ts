/**
 * U14 Task 6: a guest the booker adds in the form gets the booker's language. Guests were always English: text,
 * date, clock and title, and the "en" stayed on their attendee row for every later mail. Real translations.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prisma";

import i18nMock from "@calcom/testing/lib/__mocks__/libServerI18n";
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
import { test } from "@calcom/testing/lib/fixtures/fixtures";

import { beforeEach, describe, expect, vi } from "vitest";

import { getNewBookingHandler } from "./getNewBookingHandler";

type Mail = { to: string; subject: string; html: string };

describe("handleNewBooking guest language", () => {
  setupAndTeardown();

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("@calcom/i18n/server")>("@calcom/i18n/server");
    i18nMock.getTranslation.mockImplementation(actual.getTranslation as never);
  });

  const book = async (language: string) => {
    const handleNewBooking = getNewBookingHandler();
    const booker = getBooker({ email: "booker@example.com", name: "Bob Booker" });
    const organizer = getOrganizer({
      name: "Hana Host",
      email: "organizer@example.com",
      username: "organizer",
      id: 101,
      schedules: [TestData.schedules.IstWorkHours],
      credentials: [getGoogleCalendarCredential()],
      selectedCalendars: [TestData.selectedCalendars.google],
    });

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slotInterval: 30,
            length: 30,
            locations: [{ type: "inPerson", address: "Ljubljana" }],
            users: [{ id: 101 }],
          },
        ],
        organizer,
        apps: [TestData.apps["google-calendar"]],
      })
    );
    await mockCalendarToHaveNoBusySlots("googlecalendar", {
      create: { id: "MOCKED_GOOGLE_CALENDAR_EVENT_ID" },
    });

    const created = await handleNewBooking({
      bookingData: getMockRequestDataForBooking({
        data: {
          user: organizer.username,
          eventTypeId: 1,
          language,
          responses: {
            email: booker.email,
            name: booker.name,
            location: { optionValue: "", value: "inPerson" },
            guests: ["guest@example.com"],
          } as never,
        },
      }),
    });

    const attendees = await prismaMock.attendee.findMany({ where: { bookingId: created.id } });
    return attendees.find((attendee: { email: string }) => attendee.email === "guest@example.com");
  };

  const guestMail = (emails: { get: () => unknown[] }) => {
    const found = (emails.get() as Mail[]).filter((mail) => mail.to.includes("guest@example.com"));
    expect(found).toHaveLength(1);
    return found[0];
  };

  test("a guest of a Slovene booking gets Slovene text and a Slovene date", async ({ emails }) => {
    const guest = await book("sl");

    expect(guest?.locale).toBe("sl");
    const { html } = guestMail(emails);
    expect(html).toContain("Vaš dogodek je razporejen");
    expect(html).not.toContain("Your event has been scheduled");
    // dddd, LL in sl: a weekday from the Slovene list. English weekdays must not appear.
    expect(html).toMatch(/nedelja|ponedeljek|torek|sreda|četrtek|petek|sobota/);
    expect(html).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
  });

  test("a guest of an English booking stays English", async ({ emails }) => {
    const guest = await book("en");

    expect(guest?.locale).toBe("en");
    expect(guestMail(emails).html).toContain("Your event has been scheduled");
  });
});
