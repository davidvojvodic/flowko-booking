/**
 * U14 Task 6: every mail is in its recipient's language. Real translations (packages/i18n/locales), real
 * templates, real .ics; only the database and the mail transport are out (INTEGRATION_TEST_MODE collects the
 * payloads in globalThis.testEmails).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getTranslation } from "@calcom/i18n/server";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import {
  sendAddGuestsEmailsAndSMS,
  sendAttendeeRequestEmailAndSMS,
  sendCancelledEmailsAndSMS,
  sendDeclinedEmailsAndSMS,
  sendLocationChangeEmailsAndSMS,
  sendOrganizerRequestEmail,
  sendRequestRescheduleEmailAndSMS,
  sendRescheduledEmailsAndSMS,
  sendScheduledEmailsAndSMS,
} from "./email-manager";
import generateIcsString from "./lib/generateIcsString";
import renderEmail from "./src/renderEmail";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));
vi.mock("@calcom/features/flags/operations/check-if-user-has-feature.controller", () => ({
  checkIfUserHasFeatureController: vi.fn(async () => false),
}));

type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  icalEvent?: { content: string };
};

const mails = () => (globalThis.testEmails ?? []) as unknown as Mail[];
const mailTo = (address: string) => {
  const found = mails().filter((mail) => mail.to.includes(address));
  expect(found, `one mail to ${address}`).toHaveLength(1);
  return found[0];
};
// .ics folds long lines; a fold is CRLF plus one space
const unfold = (ics: string | undefined) => (ics ?? "").replace(/\r\n[ \t]/g, "");

const person = async (locale: string, name: string, email: string): Promise<Person> => ({
  name,
  email,
  timeZone: "Europe/Ljubljana",
  language: { translate: await getTranslation(locale, "common"), locale },
});

const buildEvent = async ({
  hostLocale,
  bookerLocale,
  title,
  guestLocale,
}: {
  hostLocale: string;
  bookerLocale: string;
  title: string;
  guestLocale?: string;
}): Promise<CalendarEvent> =>
  ({
    bookerUrl: "https://booking.example.com",
    type: "ogled",
    title,
    uid: "booking-uid",
    iCalUID: "booking-uid@example.com",
    startTime: "2026-12-15T10:00:00.000Z",
    endTime: "2026-12-15T10:30:00.000Z",
    organizer: await person(hostLocale, "Hana Host", "host@example.com"),
    attendees: [
      await person(bookerLocale, "Bob Booker", "booker@example.com"),
      ...(guestLocale ? [await person(guestLocale, "", "guest@example.com")] : []),
    ],
    location: "https://meet.example.com/abc",
    length: 30,
  }) as unknown as CalendarEvent;

const SL_TITLE = "Ogled med Hana Host in Bob Booker";
const EN_TITLE = "Ogled between Hana Host and Bob Booker";
const TITLE_SOURCE = { eventType: "Ogled", eventName: null };

beforeAll(() => {
  vi.stubEnv("INTEGRATION_TEST_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", "https://booking.example.com");
  // 32 bytes, like the real one: the request mail's confirm links are encrypted
  vi.stubEnv("CALENDSO_ENCRYPTION_KEY", "abcdefghjnmkljhjklmnhjklkmnbhjui");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  globalThis.testEmails = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("a booker's title follows the booker's language, the host's mail stays as stored", () => {
  const event = () => buildEvent({ hostLocale: "sl", bookerLocale: "en", title: SL_TITLE });

  it("reschedule", async () => {
    await sendRescheduledEmailsAndSMS(await event(), undefined, TITLE_SOURCE);

    const booker = mailTo("booker@example.com");
    expect(booker.subject).toContain(EN_TITLE);
    expect(unfold(booker.icalEvent?.content)).toContain(`SUMMARY:${EN_TITLE}`);
    expect(booker.html).toContain(EN_TITLE);
    expect(mailTo("host@example.com").subject).toContain(SL_TITLE);
  });

  it("accepted request", async () => {
    await sendScheduledEmailsAndSMS(await event(), undefined, false, false, undefined, TITLE_SOURCE);

    expect(mailTo("booker@example.com").subject).toBe(EN_TITLE);
    expect(mailTo("host@example.com").subject).toContain(SL_TITLE);
  });

  it("request received", async () => {
    const evt = await event();
    await sendAttendeeRequestEmailAndSMS(evt, evt.attendees[0], undefined, TITLE_SOURCE);

    expect(mailTo("booker@example.com").subject).toContain(EN_TITLE);
  });

  it("declined", async () => {
    await sendDeclinedEmailsAndSMS(await event(), undefined, TITLE_SOURCE);

    expect(mailTo("booker@example.com").subject).toContain(EN_TITLE);
  });

  it("location change", async () => {
    await sendLocationChangeEmailsAndSMS(await event(), undefined, TITLE_SOURCE);

    const booker = mailTo("booker@example.com");
    expect(unfold(booker.icalEvent?.content)).toContain(`SUMMARY:${EN_TITLE}`);
    expect(booker.html).toContain(EN_TITLE);
    expect(unfold(mailTo("host@example.com").icalEvent?.content)).toContain(`SUMMARY:${SL_TITLE}`);
  });

  it("guests added, for the booker and for the new guest", async () => {
    const evt = await buildEvent({
      hostLocale: "sl",
      bookerLocale: "en",
      guestLocale: "en",
      title: SL_TITLE,
    });
    await sendAddGuestsEmailsAndSMS({
      calEvent: evt,
      newGuests: ["guest@example.com"],
      titleSource: TITLE_SOURCE,
    });

    expect(unfold(mailTo("booker@example.com").icalEvent?.content)).toContain(`SUMMARY:${EN_TITLE}`);
    // A guest has no name of their own: the title names the booker
    expect(mailTo("guest@example.com").subject).toBe(EN_TITLE);
    expect(unfold(mailTo("host@example.com").icalEvent?.content)).toContain(`SUMMARY:${SL_TITLE}`);
  });

  it("each recipient gets their own language when booker and guest differ", async () => {
    const evt = await buildEvent({
      hostLocale: "en",
      bookerLocale: "sl",
      guestLocale: "en",
      title: EN_TITLE,
    });
    await sendDeclinedEmailsAndSMS(evt, undefined, TITLE_SOURCE);

    expect(mailTo("booker@example.com").subject).toContain(SL_TITLE);
    expect(mailTo("guest@example.com").subject).toContain(EN_TITLE);
  });
});

describe("the stored title is kept where a rebuild would be a guess", () => {
  const event = () => buildEvent({ hostLocale: "sl", bookerLocale: "en", title: "Stored title" });

  it("the event type has its own name template", async () => {
    await sendDeclinedEmailsAndSMS(await event(), undefined, {
      eventType: "Ogled",
      eventName: "{Event type title}: {Scheduler}",
    });
    expect(mailTo("booker@example.com").subject).toContain("Stored title");
  });

  it("the caller doesn't know whether a template exists", async () => {
    await sendDeclinedEmailsAndSMS(await event(), undefined, { eventType: "Ogled" });
    expect(mailTo("booker@example.com").subject).toContain("Stored title");
  });

  it("the event type is gone", async () => {
    await sendDeclinedEmailsAndSMS(await event(), undefined, { eventType: undefined, eventName: undefined });
    expect(mailTo("booker@example.com").subject).toContain("Stored title");
  });

  it("no source at all", async () => {
    await sendDeclinedEmailsAndSMS(await event());
    expect(mailTo("booker@example.com").subject).toContain("Stored title");
  });

  it("the first attendee has no name", async () => {
    const evt = await event();
    evt.attendees[0].name = "";
    await sendDeclinedEmailsAndSMS(evt, undefined, TITLE_SOURCE);
    expect(mailTo("booker@example.com").subject).toContain("Stored title");
  });
});

describe("cancellation title", () => {
  it("is not nested twice and is in the booker's language", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "en", title: SL_TITLE });
    await sendCancelledEmailsAndSMS(evt, TITLE_SOURCE);

    const { subject } = mailTo("booker@example.com");
    expect(subject).toContain(EN_TITLE);
    expect(subject).not.toContain(SL_TITLE);
    expect(subject.match(/between/g)).toHaveLength(1);
  });

  it("is not doubled in Slovene, and a guest's title still names the booker", async () => {
    const evt = await buildEvent({
      hostLocale: "sl",
      bookerLocale: "sl",
      guestLocale: "sl",
      title: SL_TITLE,
    });
    await sendCancelledEmailsAndSMS(evt, TITLE_SOURCE);

    for (const address of ["booker@example.com", "guest@example.com"]) {
      const { subject } = mailTo(address);
      expect(subject).toContain(SL_TITLE);
      expect(subject.match(/ med /g)).toHaveLength(1);
    }
  });

  it("keeps the stored title when the event type has a name template, or is gone", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "en", title: "Ogled: Bob Booker" });
    await sendCancelledEmailsAndSMS(evt, {
      eventType: "Ogled",
      eventName: "{Event type title}: {Scheduler}",
    });
    expect(mailTo("booker@example.com").subject).toContain("Ogled: Bob Booker");
    expect(mailTo("booker@example.com").subject.match(/Ogled/g)).toHaveLength(1);

    globalThis.testEmails = [];
    await sendCancelledEmailsAndSMS(evt, { eventType: undefined, eventName: undefined });
    expect(mailTo("booker@example.com").subject.match(/Ogled/g)).toHaveLength(1);
  });
});

describe(".ics DESCRIPTION", () => {
  const description = (mail: Mail) => {
    const ics = unfold(mail.icalEvent?.content);
    return ics.slice(ics.indexOf("DESCRIPTION:"), ics.indexOf("\r\n", ics.indexOf("DESCRIPTION:")));
  };

  const senders: [string, (evt: CalendarEvent) => Promise<unknown>][] = [
    ["confirmation", (evt) => sendScheduledEmailsAndSMS(evt)],
    ["rescheduled", (evt) => sendRescheduledEmailsAndSMS(evt)],
    ["cancelled", (evt) => sendCancelledEmailsAndSMS(evt, {})],
    ["location change", (evt) => sendLocationChangeEmailsAndSMS(evt)],
    ["guests added", (evt) => sendAddGuestsEmailsAndSMS({ calEvent: evt, newGuests: [] })],
    [
      "reschedule request",
      (evt) => sendRequestRescheduleEmailAndSMS(evt, { rescheduleLink: "https://booking.example.com/r" }),
    ],
  ];

  it.each(senders)("%s: in the booker's language with an English host", async (_name, send) => {
    const evt = await buildEvent({ hostLocale: "en", bookerLocale: "sl", title: "Ogled" });
    await send(evt);

    const booker = description(mails().filter((mail) => mail.to.includes("booker@example.com"))[0]);
    expect(booker).toContain("Kaj:");
    expect(booker).not.toContain("What:");
  });

  it("stays in the host's language in the host's own file", async () => {
    const evt = await buildEvent({ hostLocale: "en", bookerLocale: "sl", title: "Ogled" });
    await sendScheduledEmailsAndSMS(evt);

    const host = description(mailTo("host@example.com"));
    expect(host).toContain("What:");
    expect(host).not.toContain("Kaj:");
  });
});

describe("hideOrganizerEmail (U7a) survives the per-recipient title", () => {
  it("the booker's mail and .ics don't carry the host's address", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "en", title: SL_TITLE });
    evt.hideOrganizerEmail = true;
    await sendRescheduledEmailsAndSMS(evt, undefined, TITLE_SOURCE);

    const booker = mailTo("booker@example.com");
    expect(booker.subject).toContain(EN_TITLE);
    expect(booker.html).not.toContain("host@example.com");
    expect(booker.text).not.toContain("host@example.com");
    expect(unfold(booker.icalEvent?.content)).not.toContain("host@example.com");
  });
});

describe("hard-coded text", () => {
  it("the reschedule request's button uses the key", async () => {
    const evt = await buildEvent({ hostLocale: "en", bookerLocale: "sl", title: "Ogled" });
    const html = await renderEmail("AttendeeWasRequestedToRescheduleEmail", {
      calEvent: evt,
      attendee: evt.attendees[0],
      metadata: { rescheduleLink: "https://booking.example.com/r" },
    } as never);

    expect(html).toContain("Rezervirajte nov termin");
    expect(html).not.toContain("Book a new time");
  });

  it("a link location without a provider says Povezava", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "sl", title: "Ogled" });
    const html = await renderEmail("AttendeeScheduledEmail", {
      calEvent: { ...evt, videoCallData: { url: "https://meet.example.com/abc" }, location: "" },
      attendee: evt.attendees[0],
    } as never);

    expect(html).toContain(">Povezava<");
    expect(html).not.toContain(">Link<");
  });

  it("a phone location's title is translated", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "sl", title: "Ogled" });
    const html = await renderEmail("AttendeeScheduledEmail", {
      calEvent: { ...evt, location: "+38640123456" },
      attendee: evt.attendees[0],
    } as never);

    expect(html).toContain('title="Telefon"');
    expect(html).not.toContain('title="Phone"');
  });

  it("PRODID names Flowko", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "sl", title: "Ogled" });
    const ics = generateIcsString({ event: evt, status: "CONFIRMED" });

    expect(ics).toContain("PRODID:-//Flowko//Rezervacije//SL\r\n");
    expect(ics).not.toContain("calcom");
  });

  it("the organizer request's plain text has a working link", async () => {
    const evt = await buildEvent({ hostLocale: "sl", bookerLocale: "sl", title: "Ogled" });
    await sendOrganizerRequestEmail(evt);

    const { text } = mailTo("host@example.com");
    expect(text).toContain("https://booking.example.com/bookings/upcoming");
    expect(text).not.toContain(" + ");
  });
});

describe("<html lang>", () => {
  it("is the recipient's language on a booking mail, and keeps the Outlook namespaces", async () => {
    const evt = await buildEvent({ hostLocale: "en", bookerLocale: "sl", title: "Ogled" });
    await sendScheduledEmailsAndSMS(evt);

    for (const [address, lang] of [
      ["booker@example.com", "sl"],
      ["host@example.com", "en"],
    ]) {
      const { html } = mailTo(address);
      expect(html).toMatch(new RegExp(`<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml"`));
      expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    }
  });

  it.each(["sl", "en"])("is set on the account mails too (%s)", async (locale) => {
    const language = await getTranslation(locale, "common");
    const user = {
      name: "Hana",
      email: "host@example.com",
      emailFrom: "a@example.com",
      emailTo: "b@example.com",
    };
    const htmls = await Promise.all([
      renderEmail("ForgotPasswordEmail", { language, user, resetLink: "https://example.com" } as never),
      renderEmail("VerifyAccountEmail", {
        language,
        user,
        verificationEmailLink: "https://example.com",
      } as never),
      renderEmail("VerifyEmailChangeEmail", {
        language,
        user,
        verificationEmailLink: "https://example.com",
      } as never),
      renderEmail("VerifyEmailByCode", { language, user, verificationEmailCode: "123456" } as never),
      renderEmail("BrokenCalendarConnectionEmail", {
        t: language,
        userName: "Hana",
        appName: "Google",
        blocksBookingPage: false,
      } as never),
    ]);

    for (const html of htmls) expect(html).toContain(`<html lang="${locale}" xmlns=`);
  });

  it("is left out when the language is unknown, and the namespaces still apply", async () => {
    const html = await renderEmail("ForgotPasswordEmail", {
      language: ((key: string) => key) as never,
      user: { name: "Hana", email: "host@example.com" },
      resetLink: "https://example.com",
    } as never);

    expect(html).toContain('<html xmlns="http://www.w3.org/1999/xhtml"');
  });
});
