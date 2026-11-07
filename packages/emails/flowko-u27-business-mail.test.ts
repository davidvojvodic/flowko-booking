// Flowko U27: the mail layer of a business booking (E1-E3). The customer's mails name the business as sender,
// offer the cancel link plus "call the business" instead of the reschedule link, and a desk-only worker's
// placeholder address (@flowko.invalid) never shows in the text, the .ics or the who-line. Real translations and
// templates; the database is prismock and the mail transport is out (INTEGRATION_TEST_MODE collects the payloads
// in globalThis.testEmails, before any transport). The snapshot of a plain booking's mail was recorded before U27.
import prismock from "@calcom/testing/lib/__mocks__/prisma";
// The prismock factory runs when @calcom/prisma is first imported.
import "@calcom/prisma";
import { CalendarEventBuilder } from "@calcom/features/CalendarEventBuilder";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { addLoginMember, createBusiness } from "@calcom/features/flowkoBusiness/business";
import type { FlowkoDb } from "@calcom/features/flowkoBusiness/db";
import { ensureWorkerMirror } from "@calcom/features/flowkoBusiness/mirror";
import { getTranslation } from "@calcom/i18n/server";
import { getRichDescription, getWho } from "@calcom/lib/CalEventParser";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus, FlowkoBusinessRole } from "@calcom/prisma/enums";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AttendeeCancelledEmail from "./templates/attendee-cancelled-email";
import AttendeeCancelledSeatEmail from "./templates/attendee-cancelled-seat-email";
import AttendeeDeclinedEmail from "./templates/attendee-declined-email";
import AttendeeReminderEmail from "./templates/attendee-reminder-email";
import AttendeeRescheduledEmail from "./templates/attendee-rescheduled-email";
import AttendeeScheduledEmail from "./templates/attendee-scheduled-email";
import OrganizerCancelledEmail from "./templates/organizer-cancelled-email";
import OrganizerScheduledEmail from "./templates/organizer-scheduled-email";
import { attendeeFromName } from "./lib/flowkoSender";

// The exempt-domain list is read when @calcom/lib/constants loads: it holds the desk domain here, so the .ics
// test proves the desk address is hidden even where an exempt domain would show it.
vi.mock("@calcom/lib/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calcom/lib/constants")>()),
  ORGANIZER_EMAIL_EXEMPT_DOMAINS: "flowko.invalid",
}));
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
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  icalEvent?: { filename: string; content: string; method: string };
};

const load = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(__dirname, `../i18n/locales/${lang}/common.json`), "utf8"));
const en = load("en");
const sl = load("sl");

const mails = () => (globalThis.testEmails ?? []) as unknown as Mail[];
const lastMail = () => {
  const all = mails();
  return all[all.length - 1];
};

const BUSINESS = { name: "Salon Lepota", phone: "+38641123456" };
const PHONE_LINE = "Za prestavitev termina pokličite +38641123456.";
const CONTACT_LINE = "Za prestavitev termina se obrnite na Salon Lepota.";
const CANCEL_HERE = "Termin lahko odpoveste tukaj:";
const CANCEL_LINK = "https://booking.example.com/booking/booking-uid?cancel=true&allRemainingBookings=false";
const DESK = "desk-x@flowko.invalid";

const person = async (locale: string, name: string, email: string): Promise<Person> => ({
  name,
  email,
  timeZone: "Europe/Ljubljana",
  language: { translate: await getTranslation(locale, "common"), locale },
});

const buildEvent = async (extra: Partial<CalendarEvent> = {}, organizerEmail = "host@example.com") => {
  const booker = await person("sl", "Bob Booker", "booker@example.com");
  const calEvent = {
    bookerUrl: "https://booking.example.com",
    type: "flowko-termin-7",
    title: "Salon Lepota",
    uid: "booking-uid",
    iCalUID: "booking-uid@example.com",
    startTime: "2026-12-15T10:00:00.000Z",
    endTime: "2026-12-15T10:30:00.000Z",
    organizer: await person("sl", "Ana", organizerEmail),
    attendees: [booker],
    location: "",
    length: 30,
    ...extra,
  } as unknown as CalendarEvent;
  return { calEvent, booker };
};

// HTML entity escaping undone, whitespace collapsed: the sentences are checked as the reader sees them.
const plain = (html: string) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** The .ics DESCRIPTION, unfolded and unescaped (RFC 5545 3.1 and 3.3.11). */
const icsDescription = (ics: string) => {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const line = unfolded.split(/\r?\n/).find((l) => l.startsWith("DESCRIPTION:")) ?? "";
  return line
    .slice("DESCRIPTION:".length)
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1");
};
const icsOrganizer = (ics: string) =>
  ics
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .find((l) => l.startsWith("ORGANIZER")) ?? "";

const displayName = (from: string) => from.replace(/\s*<[^>]*>$/, "");

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

describe("U27 mails without a business (unchanged)", () => {
  it("the attendee confirmation is byte-equal to the one before U27", async () => {
    const { calEvent, booker } = await buildEvent();

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    const mail = lastMail();
    expect({
      from: mail.from,
      to: mail.to,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      // ics stamps DTSTAMP when the module loads
      ics: mail.icalEvent?.content.replace(/DTSTAMP:\d{8}T\d{6}Z/, "DTSTAMP:<module load>"),
    }).toMatchSnapshot();
  });

  it("flowkoBusiness null behaves as absent", async () => {
    const { calEvent, booker } = await buildEvent();
    const { calEvent: withNull } = await buildEvent({ flowkoBusiness: null });

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();
    await new AttendeeScheduledEmail(withNull, booker).sendEmail();

    const [a, b] = mails();
    expect(b.from).toBe(a.from);
    expect(b.text).toBe(a.text);
    expect(b.html).toBe(a.html);
    expect(b.icalEvent?.content).toBe(a.icalEvent?.content);
  });
});

describe("U27 business booking mails (E1, E2)", () => {
  it.each([
    ["AttendeeScheduledEmail", AttendeeScheduledEmail],
    ["AttendeeRescheduledEmail", AttendeeRescheduledEmail],
    ["AttendeeCancelledEmail", AttendeeCancelledEmail],
    ["AttendeeReminderEmail", AttendeeReminderEmail],
  ] as const)("%s comes from the business name", async (_name, Template) => {
    const { calEvent, booker } = await buildEvent({ flowkoBusiness: BUSINESS });

    await new Template(calEvent, booker).sendEmail();

    expect(displayName(lastMail().from)).toBe("Salon Lepota");
  });

  it("the organizer's mail sender is unchanged", async () => {
    const { calEvent } = await buildEvent();
    const { calEvent: business } = await buildEvent({ flowkoBusiness: BUSINESS });

    await new OrganizerScheduledEmail({ calEvent }).sendEmail();
    await new OrganizerScheduledEmail({ calEvent: business }).sendEmail();

    const [before, after] = mails();
    expect(after.from).toBe(before.from);
  });

  it("the HTML offers the cancel link and the phone, never the reschedule link", async () => {
    const { calEvent, booker } = await buildEvent({ flowkoBusiness: BUSINESS });

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    const html = plain(lastMail().html);
    expect(html).toContain("Odpovej");
    expect(html).toContain("/booking/booking-uid?cancel=true");
    expect(html).toContain(PHONE_LINE);
    expect(html).not.toContain("Prestavi termin");
    expect(html).not.toContain("/reschedule/");
  });

  it("the text and the .ics have the cancel link line and the phone line, not the manage page", async () => {
    const { calEvent, booker } = await buildEvent({ flowkoBusiness: BUSINESS });

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    const mail = lastMail();
    const description = icsDescription(mail.icalEvent?.content ?? "");
    for (const body of [mail.text, description]) {
      expect(body).toContain(`${CANCEL_HERE} ${CANCEL_LINK}`);
      expect(body).toContain(PHONE_LINE);
      expect(body).not.toContain("?changes=true");
      expect(body).not.toContain("/reschedule/");
    }
  });

  it("without a phone the contact line names the business", async () => {
    const { calEvent, booker } = await buildEvent({ flowkoBusiness: { ...BUSINESS, phone: null } });

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    const mail = lastMail();
    expect(plain(mail.html)).toContain(CONTACT_LINE);
    expect(mail.text).toContain(CONTACT_LINE);
    expect(icsDescription(mail.icalEvent?.content ?? "")).toContain(CONTACT_LINE);
    expect(mail.text).not.toContain("pokličite");
  });

  it("a business name with a comma is quoted in From", async () => {
    const { calEvent, booker } = await buildEvent({
      flowkoBusiness: { name: 'Frizerstvo "Ana", s.p.', phone: null },
    });

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    expect(displayName(lastMail().from)).toBe('"Frizerstvo \\"Ana\\", s.p."');
    expect(mails()[0].text).toContain('Za prestavitev termina se obrnite na Frizerstvo "Ana", s.p..');
  });

  it("attendeeFromName falls back to the organizer's name", async () => {
    const { calEvent } = await buildEvent();
    expect(attendeeFromName(calEvent)).toBe("Ana");
    expect(attendeeFromName({ ...calEvent, flowkoBusiness: BUSINESS })).toBe("Salon Lepota");
  });

  describe.each([
    ["AttendeeCancelledEmail", AttendeeCancelledEmail],
    ["AttendeeCancelledSeatEmail", AttendeeCancelledSeatEmail],
    ["AttendeeDeclinedEmail", AttendeeDeclinedEmail],
  ] as const)("a cancelled business booking: %s", (_name, Template) => {
    it("shows only the phone line, no cancel link", async () => {
      const { calEvent, booker } = await buildEvent({ flowkoBusiness: BUSINESS });

      await new Template(calEvent, booker).sendEmail();

      const mail = lastMail();
      const bodies = [mail.text];
      if (mail.icalEvent) bodies.push(icsDescription(mail.icalEvent.content));
      for (const body of bodies) {
        expect(body).toContain(PHONE_LINE);
        expect(body).not.toContain(CANCEL_HERE);
        expect(body).not.toContain("cancel=true");
        expect(body).not.toContain("?changes=true");
      }
      const html = plain(mail.html);
      expect(html).toContain(PHONE_LINE);
      expect(html).not.toContain(CANCEL_HERE);
      expect(html).not.toContain("cancel=true");
      expect(displayName(mail.from)).toBe("Salon Lepota");
    });

    it("without a phone the HTML names the business", async () => {
      const { calEvent, booker } = await buildEvent({ flowkoBusiness: { ...BUSINESS, phone: null } });

      await new Template(calEvent, booker).sendEmail();

      const html = plain(lastMail().html);
      expect(html).toContain(CONTACT_LINE);
      expect(html).not.toContain("cancel=true");
    });

    it("a plain booking's HTML has no call to action, as before", async () => {
      const { calEvent, booker } = await buildEvent();

      await new Template(calEvent, booker).sendEmail();

      const html = plain(lastMail().html);
      expect(html).not.toContain("Za prestavitev termina");
      expect(html).not.toContain("cancel=true");
      expect(html).not.toContain("/reschedule/");
    });
  });

  it("the organizer's cancelled mail has no cancel link either", async () => {
    const { calEvent } = await buildEvent({ flowkoBusiness: BUSINESS });

    await new OrganizerCancelledEmail({ calEvent }).sendEmail();

    const mail = lastMail();
    for (const body of [mail.text, icsDescription(mail.icalEvent?.content ?? ""), plain(mail.html)]) {
      expect(body).toContain(PHONE_LINE);
      expect(body).not.toContain(CANCEL_HERE);
      expect(body).not.toContain("cancel=true");
    }
  });

  it("the cancelled mail's .ics carries the phone line (status CANCELLED)", async () => {
    const { calEvent, booker } = await buildEvent({ flowkoBusiness: { ...BUSINESS, phone: null } });

    await new AttendeeCancelledEmail(calEvent, booker).sendEmail();

    const ics = lastMail().icalEvent?.content ?? "";
    expect(ics).toContain("STATUS:CANCELLED");
    expect(icsDescription(ics)).toContain(CONTACT_LINE);
    expect(icsDescription(ics)).not.toContain(CANCEL_HERE);
  });

  it("the calendar description (getRichDescription) has the cancel and phone lines", async () => {
    const { calEvent } = await buildEvent({ flowkoBusiness: BUSINESS });

    const description = getRichDescription(calEvent);

    expect(description).toContain(`${CANCEL_HERE} ${CANCEL_LINK}`);
    expect(description).toContain(PHONE_LINE);
    expect(description).not.toContain("?changes=true");
  });
});

describe("U27 desk organizer address never shown (E3)", () => {
  it("getWho hides a desk organizer's address and keeps a normal one", async () => {
    const { calEvent } = await buildEvent({ hideOrganizerEmail: false }, DESK);
    const { calEvent: normal } = await buildEvent({ hideOrganizerEmail: false });
    const t = calEvent.organizer.language.translate;

    const desk = getWho(calEvent, t);
    const team = getWho(
      { ...calEvent, team: { id: 1, members: [{ ...calEvent.organizer, name: "Cene" }] } },
      t
    );

    expect(desk).toContain("Ana");
    expect(desk).not.toContain("flowko.invalid");
    expect(team).toContain("Cene");
    expect(team).not.toContain("flowko.invalid");
    expect(getWho(normal, t)).toContain("host@example.com");
  });

  it("the .ics ORGANIZER is the hidden sender and no text names the desk address", async () => {
    const { calEvent, booker } = await buildEvent(
      { hideOrganizerEmail: false, flowkoBusiness: BUSINESS },
      DESK
    );

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    const mail = lastMail();
    const ics = mail.icalEvent?.content ?? "";
    expect(ics).not.toContain("flowko.invalid");
    expect(icsOrganizer(ics)).toMatch(/mailto:\S+@\S+/);
    expect(mail.text).not.toContain("flowko.invalid");
    expect(mail.html).not.toContain("flowko.invalid");
  });

  it("a normal organizer still appears in the .ics and the text", async () => {
    const { calEvent, booker } = await buildEvent({ hideOrganizerEmail: false });

    await new AttendeeScheduledEmail(calEvent, booker).sendEmail();

    const mail = lastMail();
    expect(icsOrganizer(mail.icalEvent?.content ?? "")).toContain("mailto:host@example.com");
    expect(mail.text).toContain("host@example.com");
  });
});

describe("U27 business on the built calendar event (E1)", () => {
  const db = prismock as unknown as FlowkoDb;
  const tx = prismock as unknown as Prisma.TransactionClient;

  async function makeUser(name: string) {
    return prismock.user.create({
      data: { email: `${name.toLowerCase()}@example.com`, username: name.toLowerCase(), name, locale: "sl" },
      select: { id: true },
    });
  }

  async function bookingOn(eventTypeId: number, userId: number, uid: string) {
    return prismock.booking.create({
      data: {
        uid,
        title: "Salon Lepota",
        startTime: new Date("2026-12-15T10:00:00Z"),
        endTime: new Date("2026-12-15T10:30:00Z"),
        status: BookingStatus.ACCEPTED,
        eventTypeId,
        userId,
        attendees: {
          create: [{ name: "Bob Booker", email: "booker@example.com", timeZone: "Europe/Ljubljana" }],
        },
      },
      select: { id: true },
    });
  }

  it("a booking on a mirror carries its business; a plain booking carries none", async () => {
    const olga = await makeUser("Olga");
    const created = await createBusiness(db, {
      ownerUserId: olga.id,
      name: "Salon Lepota",
      slug: "salon-lepota",
      templateId: "hair-salon",
      phone: "+38641123456",
    });
    // Prismock does not apply @default([]) to scalar lists (test-only).
    await prismock.flowkoBusiness.update({ where: { id: created.businessId }, data: { openHolidays: [] } });
    const ana = await makeUser("Ana");
    const { memberId } = await addLoginMember(db, created.businessId, ana.id, FlowkoBusinessRole.WORKER);
    const mirror = await ensureWorkerMirror(tx, memberId);
    const plainType = await prismock.eventType.create({
      data: { title: "Ogled", slug: "ogled", length: 30, owner: { connect: { id: ana.id } } },
      select: { id: true },
    });
    const onMirror = await bookingOn(mirror.eventTypeId, ana.id, "on-mirror");
    const onPlain = await bookingOn(plainType.id, ana.id, "on-plain");
    const repository = new BookingRepository(prismock);

    const build = async (id: number) => {
      const booking = await repository.getBookingForCalEventBuilder(id);
      if (!booking) throw new Error("booking not found");
      return (await CalendarEventBuilder.fromBooking(booking)).build();
    };

    expect((await build(onMirror.id)).flowkoBusiness).toEqual(BUSINESS);
    expect((await build(onPlain.id)).flowkoBusiness).toBeNull();
  });
});

describe("U27 strings", () => {
  it("are in both languages, as written", () => {
    expect(sl.flowko_reschedule_by_phone).toBe("Za prestavitev termina pokličite {{phone}}.");
    expect(sl.flowko_reschedule_contact).toBe("Za prestavitev termina se obrnite na {{name}}.");
    expect(sl.flowko_cancel_here).toBe("Termin lahko odpoveste tukaj:");
    expect(en.flowko_reschedule_by_phone).toBe("To reschedule, call {{phone}}.");
    expect(en.flowko_reschedule_contact).toBe("To reschedule, contact {{name}}.");
    expect(en.flowko_cancel_here).toBe("You can cancel the appointment here:");
  });
});
