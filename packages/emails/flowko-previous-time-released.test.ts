/**
 * U17a: after a customer moves a booking on a confirmation service, the original is already cancelled.
 * The request mail and the decline mail tell the customer so. Real translations and templates; only the
 * database and the mail transport are out (INTEGRATION_TEST_MODE collects the payloads in globalThis.testEmails).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import { sendAttendeeRequestEmailAndSMS, sendDeclinedEmailsAndSMS } from "./email-manager";

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

const buildEvent = async (locale: string, released?: boolean): Promise<CalendarEvent> =>
  ({
    bookerUrl: "https://booking.example.com",
    type: "ogled",
    title: "Ogled",
    uid: "booking-uid",
    iCalUID: "booking-uid@example.com",
    startTime: "2026-12-15T10:00:00.000Z",
    endTime: "2026-12-15T10:30:00.000Z",
    organizer: await person("sl", "Hana Host", "host@example.com"),
    attendees: [await person(locale, "Bob Booker", "booker@example.com")],
    location: "https://meet.example.com/abc",
    length: 30,
    ...(released === undefined ? {} : { flowkoPreviousTimeReleased: released }),
  }) as unknown as CalendarEvent;

// The text is checked against the plain sentence, so HTML entity escaping is undone first.
const plain = (html: string) =>
  html.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const STRINGS = {
  sl: {
    declinedTitle: "Vaša zahteva za prestavitev termina je bila zavrnjena",
    declinedLine: "Vaš prejšnji termin ni več rezerviran. Če še vedno želite termin, rezervirajte novega.",
    requestLine: "Vaš prejšnji termin ni več rezerviran.",
    plainDeclinedTitle: "Vaša zahteva za dogodek je bila zavrnjena",
  },
  en: {
    declinedTitle: "Your request to move your booking has been declined",
    declinedLine:
      "Your previous time is no longer reserved. If you still want an appointment, please book a new time.",
    requestLine: "Your previous time is no longer reserved.",
    plainDeclinedTitle: "Your event request has been declined",
  },
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

describe.each(["sl", "en"] as const)("U17a mails in %s", (locale) => {
  const s = STRINGS[locale];

  it("a declined reschedule request says the previous time is gone, in HTML and plain text", async () => {
    await sendDeclinedEmailsAndSMS(await buildEvent(locale, true));

    const mail = mailTo("booker@example.com");
    for (const body of [plain(mail.html), mail.text]) {
      expect(body).toContain(s.declinedTitle);
      expect(body).toContain(s.declinedLine);
      expect(body).not.toContain(s.plainDeclinedTitle);
    }
  });

  it("a declined ordinary request reads as before", async () => {
    await sendDeclinedEmailsAndSMS(await buildEvent(locale));

    const mail = mailTo("booker@example.com");
    for (const body of [plain(mail.html), mail.text]) {
      expect(body).toContain(s.plainDeclinedTitle);
      expect(body).not.toContain(s.requestLine);
    }
  });

  it("a reschedule request mail says the previous time is gone, in HTML and plain text", async () => {
    const evt = await buildEvent(locale, true);
    await sendAttendeeRequestEmailAndSMS(evt, evt.attendees[0]);

    const mail = mailTo("booker@example.com");
    for (const body of [plain(mail.html), mail.text]) {
      expect(body).toContain(s.requestLine);
      expect(body).not.toContain(s.declinedLine);
    }
  });

  it("an ordinary request mail does not", async () => {
    const evt = await buildEvent(locale, false);
    await sendAttendeeRequestEmailAndSMS(evt, evt.attendees[0]);

    const mail = mailTo("booker@example.com");
    expect(plain(mail.html)).not.toContain(s.requestLine);
    expect(mail.text).not.toContain(s.requestLine);
  });
});
