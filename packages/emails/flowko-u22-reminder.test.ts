/**
 * U22: the reminder mail goes to the booker only, in the booker's language, without an .ics, with the plain-text
 * „Kdaj:“ line and the manage links of the confirmation. Real translations and templates; only the database and the
 * mail transport are out (INTEGRATION_TEST_MODE collects the payloads in globalThis.testEmails).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAttendeeReminderEmail } from "./email-manager";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));
vi.mock("@calcom/features/flags/operations/check-if-user-has-feature.controller", () => ({
  checkIfUserHasFeatureController: vi.fn(async () => false),
}));

type Mail = { to: string; subject: string; html: string; text: string; icalEvent?: unknown };

const load = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(__dirname, `../i18n/locales/${lang}/common.json`), "utf8"));
const en = load("en");
const sl = load("sl");

const mails = () => (globalThis.testEmails ?? []) as unknown as Mail[];

const person = async (locale: string, name: string, email: string): Promise<Person> => ({
  name,
  email,
  timeZone: "Europe/Ljubljana",
  language: { translate: await getTranslation(locale, "common"), locale },
});

// The host's language is Slovene in every case, so a title rebuilt in English shows it follows the booker.
const STORED_TITLE = "Ogled med Hana Host in Bob Booker";
const TITLE_SOURCE = { eventType: "Ogled", eventName: null };

const buildEvent = async (locale: string, extra: Partial<CalendarEvent> = {}) => {
  const booker = await person(locale, "Bob Booker", "booker@example.com");
  const calEvent = {
    bookerUrl: "https://booking.example.com",
    type: "Ogled",
    title: STORED_TITLE,
    uid: "booking-uid",
    iCalUID: "booking-uid@example.com",
    startTime: "2026-12-15T10:00:00.000Z",
    endTime: "2026-12-15T10:30:00.000Z",
    organizer: await person("sl", "Hana Host", "host@example.com"),
    attendees: [booker, await person(locale, "", "guest@example.com")],
    location: "https://meet.example.com/abc",
    length: 30,
    ...extra,
  } as unknown as CalendarEvent;
  return { calEvent, booker };
};

// The text is checked against the plain sentence, so HTML entity escaping is undone first.
const plain = (html: string) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const STRINGS = {
  sl: {
    subject: "Opomnik: Ogled – 11:00 - 11:30, torek, 15. december 2026",
    title: "Opomnik na vaš termin",
    subtitle: "To je opomnik na vaš rezervirani termin. Podrobnosti so spodaj.",
    when: "Kdaj:",
    date: "15. december 2026",
    time: "11:00",
    bookerTitle: "Ogled med Hana Host in Bob Booker",
    allAttendees: "Vsem smo te podatke poslali po e-pošti.",
  },
  en: {
    subject: "Reminder: Ogled – 11:00am - 11:30am, Tuesday, December 15, 2026",
    title: "Reminder of your appointment",
    subtitle: "This is a reminder of your booked appointment. The details are below.",
    when: "When:",
    date: "December 15, 2026",
    time: "11:00",
    bookerTitle: "Ogled between Hana Host and Bob Booker",
    allAttendees: "We sent an email to everyone with this information.",
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

describe.each(["sl", "en"] as const)("U22 reminder mail in %s", (locale) => {
  const s = STRINGS[locale];

  it("sends exactly one mail, to the booker, without an .ics", async () => {
    const { calEvent, booker } = await buildEvent(locale);

    const outcome = await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {});

    expect(outcome).toBe("skipped_test_mode");
    expect(mails()).toHaveLength(1);
    const [mail] = mails();
    expect(mail.to).toContain("booker@example.com");
    expect(mail.to).not.toContain("guest@example.com");
    expect(mail).not.toHaveProperty("icalEvent");
    expect(mail.subject).toBe(s.subject);
  });

  it("the plain text names the date and time and not the all-attendees line", async () => {
    const { calEvent, booker } = await buildEvent(locale);

    await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {});

    const { text } = mails()[0];
    expect(text).toContain(s.title);
    expect(text).toContain(s.subtitle);
    expect(text).toContain(s.when);
    expect(text).toContain(s.date);
    expect(text).toContain(s.time);
    expect(text).not.toContain(s.allAttendees);
  });

  it("the HTML has the title, the subtitle and the manage links", async () => {
    const { calEvent, booker } = await buildEvent(locale);

    await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {});

    const html = plain(mails()[0].html);
    expect(html).toContain(s.title);
    expect(html).toContain(s.subtitle);
    expect(html).not.toContain(s.allAttendees);
    expect(html).toContain("/booking/booking-uid?cancel=true");
    expect(html).toContain("/reschedule/booking-uid");
  });

  it("hides the cancel link when cancelling is disabled", async () => {
    const { calEvent, booker } = await buildEvent(locale, { disableCancelling: true });

    await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {});

    const html = plain(mails()[0].html);
    expect(html).not.toContain("cancel=true");
    expect(html).toContain("/reschedule/booking-uid");
  });

  it("keeps a hidden organiser address out of the HTML and the text", async () => {
    const { calEvent, booker } = await buildEvent(locale, { hideOrganizerEmail: true });

    await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {});

    const { html, text } = mails()[0];
    expect(html).not.toContain("host@example.com");
    expect(text).not.toContain("host@example.com");
  });

  it("rebuilds the booking title in the booker's language", async () => {
    const { calEvent, booker } = await buildEvent(locale);

    await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {});

    const { html, text } = mails()[0];
    expect(plain(html)).toContain(s.bookerTitle);
    expect(text).toContain(s.bookerTitle);
  });

  it("sends nothing when the service turned attendee mails off", async () => {
    const { calEvent, booker } = await buildEvent(locale);

    const outcome = await sendAttendeeReminderEmail(calEvent, booker, TITLE_SOURCE, {
      disableStandardEmails: { all: { attendee: true } },
    });

    expect(outcome).toBe("skipped_disabled");
    expect(mails()).toHaveLength(0);
  });
});

describe("U22 reminder strings", () => {
  const KEYS = ["flowko_reminder_subject", "flowko_reminder_title", "flowko_reminder_subtitle"] as const;

  it("are in both languages, as written", () => {
    // An en dash (U+2013) with spaces between the service and the date (Slovene read)
    expect(sl.flowko_reminder_subject).toBe("Opomnik: {{eventType}} – {{date}}");
    expect(en.flowko_reminder_subject).toBe("Reminder: {{eventType}} – {{date}}");
    expect(sl.flowko_reminders_hint).toBe(
      "Opomnik se ne pošlje, če je bil termin rezerviran ali potrjen pozneje kot eno uro pred načrtovanim časom pošiljanja."
    );
    expect(en.flowko_reminders_hint).toBe(
      "No reminder is sent if the appointment was booked or confirmed later than one hour before the reminder is due to go out."
    );
    expect(sl.flowko_reminder_title).toBe(STRINGS.sl.title);
    expect(en.flowko_reminder_title).toBe(STRINGS.en.title);
    expect(sl.flowko_reminder_subtitle).toBe(STRINGS.sl.subtitle);
    expect(en.flowko_reminder_subtitle).toBe(STRINGS.en.subtitle);
  });

  it("use lowercase vi/vaš inside a sentence in Slovene", () => {
    const midSentenceCapital = /(?<![.!?:]\s)(?<!^)\b(Vaš|Vaša|Vaše|Vašo|Vašega|Vaših|Vam|Vas|Vi|Vami)\b/;
    for (const key of KEYS) {
      expect(sl[key], key).not.toMatch(midSentenceCapital);
    }
  });
});
