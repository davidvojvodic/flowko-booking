/**
 * U18: the plain-text part names the date and time; an empty apps status shows no heading. Real translations and templates; only the
 * database and the mail transport are out (INTEGRATION_TEST_MODE collects the payloads in globalThis.testEmails).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import { sendRescheduledEmailsAndSMS, sendScheduledEmailsAndSMS } from "./email-manager";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));
vi.mock("@calcom/features/flags/operations/check-if-user-has-feature.controller", () => ({
  checkIfUserHasFeatureController: vi.fn(async () => false),
}));

type Mail = { to: string; subject: string; html: string; text: string };

const mails = () => (globalThis.testEmails ?? []) as unknown as Mail[];
const mailTo = (address: string) => {
  const found = mails().filter((mail) => mail.to.includes(address));
  expect(found, `one mail to ${address}`).toHaveLength(1);
  return found[0];
};

const person = async (locale: string, name: string, email: string): Promise<Person> => ({
  name,
  email,
  timeZone: "Europe/Ljubljana",
  language: { translate: await getTranslation(locale, "common"), locale },
});

const buildEvent = async (locale: string, appsStatus?: unknown[]): Promise<CalendarEvent> =>
  ({
    bookerUrl: "https://booking.example.com",
    type: "ogled",
    title: "Ogled",
    uid: "booking-uid",
    iCalUID: "booking-uid@example.com",
    startTime: "2026-12-15T10:00:00.000Z",
    endTime: "2026-12-15T10:30:00.000Z",
    organizer: await person(locale, "Hana Host", "host@example.com"),
    attendees: [await person(locale, "Bob Booker", "booker@example.com")],
    location: "https://meet.example.com/abc",
    length: 30,
    ...(appsStatus === undefined ? {} : { appsStatus }),
  }) as unknown as CalendarEvent;

const WHEN = {
  sl: { label: "Kdaj:", date: "15. december 2026", time: "11:00" },
  en: { label: "When:", date: "December 15, 2026", time: "11:00" },
} as const;

beforeAll(() => {
  vi.stubEnv("INTEGRATION_TEST_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", "https://booking.example.com");
  vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "abcdefghjnmkljhjklmnhjklkmnbhjui");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  globalThis.testEmails = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe.each(["sl", "en"] as const)("U18 plain-text date and time in %s", (locale) => {
  const w = WHEN[locale];

  it("the booker's and the host's plain text name the date and time", async () => {
    await sendScheduledEmailsAndSMS(await buildEvent(locale));

    for (const address of ["booker@example.com", "host@example.com"]) {
      const text = mailTo(address).text;
      expect(text, address).toContain(w.label);
      expect(text, address).toContain(w.date);
      expect(text, address).toContain(w.time);
    }
  });
});

describe("U18 apps status", () => {
  it("an empty apps status shows no heading, in HTML or text", async () => {
    await sendRescheduledEmailsAndSMS(await buildEvent("sl", []));

    const host = mailTo("host@example.com");
    expect(host.html).not.toContain("Stanje aplikacij");
    expect(host.text).not.toContain("Stanje aplikacij");
  });

  it("a real apps status still shows", async () => {
    await sendRescheduledEmailsAndSMS(
      await buildEvent("sl", [{ appName: "Google Calendar", type: "google_calendar", success: 1, failures: 0, errors: [] }])
    );

    expect(mailTo("host@example.com").html).toContain("Stanje aplikacij");
  });
});
