// Flowko U29a: the business e-mail is the Reply-To of the customer's mails (S6, Review Focus 3). Exactly the four
// customer mails (scheduled, rescheduled, cancelled, reminder) carry it, and only when it is set; the worker's
// (organizer) mails keep today's Reply-To and never name it. Real translations and templates; the mail transport
// is out (INTEGRATION_TEST_MODE collects the payloads in globalThis.testEmails, before any transport).
import { getTranslation } from "@calcom/i18n/server";
import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flowkoReplyToHeader } from "./lib/flowkoSender";
import AttendeeCancelledEmail from "./templates/attendee-cancelled-email";
import AttendeeReminderEmail from "./templates/attendee-reminder-email";
import AttendeeRescheduledEmail from "./templates/attendee-rescheduled-email";
import AttendeeScheduledEmail from "./templates/attendee-scheduled-email";
import OrganizerCancelledEmail from "./templates/organizer-cancelled-email";
import OrganizerRescheduledEmail from "./templates/organizer-rescheduled-email";
import OrganizerScheduledEmail from "./templates/organizer-scheduled-email";

vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));
vi.mock("@calcom/features/flags/operations/check-if-user-has-feature.controller", () => ({
  checkIfUserHasFeatureController: vi.fn(async () => false),
}));

type Mail = { to: string; from: string; replyTo?: string; subject: string };

const mails = () => (globalThis.testEmails ?? []) as unknown as Mail[];
const lastMail = () => {
  const all = mails();
  return all[all.length - 1];
};

const BUSINESS_EMAIL = "salon@example.si";
const BUSINESS = { name: "Salon Lepota", phone: "+38641123456" };

const person = async (name: string, email: string): Promise<Person> => ({
  name,
  email,
  timeZone: "Europe/Ljubljana",
  language: { translate: await getTranslation("sl", "common"), locale: "sl" },
});

/** A business booking as the mirror builds it: one attendee, hidden organizer, no custom Reply-To. */
const businessEvent = async (flowkoBusiness: CalendarEvent["flowkoBusiness"]) => {
  const booker = await person("Bob Booker", "booker@example.com");
  const calEvent = {
    bookerUrl: "https://booking.example.com",
    type: "flowko-termin-7",
    title: "Salon Lepota",
    uid: "booking-uid",
    iCalUID: "booking-uid@example.com",
    startTime: "2026-12-15T10:00:00.000Z",
    endTime: "2026-12-15T10:30:00.000Z",
    organizer: await person("Ana", "ana@example.com"),
    attendees: [booker],
    location: "",
    length: 30,
    hideOrganizerEmail: true,
    customReplyToEmail: null,
    flowkoBusiness,
  } as unknown as CalendarEvent;
  return { calEvent, booker };
};

const CUSTOMER_TEMPLATES = [
  ["AttendeeScheduledEmail", AttendeeScheduledEmail],
  ["AttendeeRescheduledEmail", AttendeeRescheduledEmail],
  ["AttendeeCancelledEmail", AttendeeCancelledEmail],
  ["AttendeeReminderEmail", AttendeeReminderEmail],
] as const;

// Today's Reply-To of the worker's mails (U28c): the customer's address; the cancelled mail has none.
const ORGANIZER_TEMPLATES = [
  ["OrganizerScheduledEmail", OrganizerScheduledEmail, "booker@example.com"],
  ["OrganizerRescheduledEmail", OrganizerRescheduledEmail, "booker@example.com"],
  ["OrganizerCancelledEmail", OrganizerCancelledEmail, undefined],
] as const;

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

describe("U29a flowkoReplyToHeader (S6)", () => {
  it("is the business e-mail when set", () => {
    expect(flowkoReplyToHeader({ flowkoBusiness: { ...BUSINESS, email: BUSINESS_EMAIL } })).toEqual({
      replyTo: BUSINESS_EMAIL,
    });
  });

  it("is empty without a business or without its e-mail", () => {
    expect(flowkoReplyToHeader({})).toEqual({});
    expect(flowkoReplyToHeader({ flowkoBusiness: null })).toEqual({});
    expect(flowkoReplyToHeader({ flowkoBusiness: BUSINESS })).toEqual({});
    expect(flowkoReplyToHeader({ flowkoBusiness: { ...BUSINESS, email: null } })).toEqual({});
    expect(flowkoReplyToHeader({ flowkoBusiness: { ...BUSINESS, email: "" } })).toEqual({});
  });

  it("getReplyToHeader gives a business booking no Reply-To of its own", async () => {
    const { calEvent, booker } = await businessEvent({ ...BUSINESS, email: BUSINESS_EMAIL });
    const otherAttendees = calEvent.attendees
      .filter(({ email }) => email !== booker.email)
      .map(({ email }) => email);

    expect(getReplyToHeader(calEvent)).toEqual({});
    expect(getReplyToHeader(calEvent, otherAttendees)).toEqual({});
  });
});

describe("U29a customer mails carry the business Reply-To (Review Focus 3)", () => {
  it.each(CUSTOMER_TEMPLATES)("%s: Reply-To is the business e-mail when set", async (_name, Template) => {
    const { calEvent, booker } = await businessEvent({ ...BUSINESS, email: BUSINESS_EMAIL });

    await new Template(calEvent, booker).sendEmail();

    expect(lastMail().replyTo).toBe(BUSINESS_EMAIL);
  });

  it.each(CUSTOMER_TEMPLATES)("%s: no Reply-To when the e-mail is unset", async (_name, Template) => {
    for (const flowkoBusiness of [{ ...BUSINESS, email: null }, BUSINESS]) {
      globalThis.testEmails = [];
      const { calEvent, booker } = await businessEvent(flowkoBusiness);

      await new Template(calEvent, booker).sendEmail();

      expect(lastMail()).not.toHaveProperty("replyTo");
    }
  });
});

describe("U29a the worker's mails keep their Reply-To (Review Focus 3)", () => {
  it.each(ORGANIZER_TEMPLATES)(
    "%s: Reply-To is today's (%s), with or without a business e-mail",
    async (_name, Template, today) => {
      const { calEvent: without } = await businessEvent({ ...BUSINESS, email: null });
      const { calEvent: withEmail } = await businessEvent({ ...BUSINESS, email: BUSINESS_EMAIL });

      await new Template({ calEvent: without }).sendEmail();
      await new Template({ calEvent: withEmail }).sendEmail();

      const [before, after] = mails();
      expect(before.replyTo).toBe(today);
      expect(after.replyTo).toBe(before.replyTo);
      for (const mail of mails()) {
        expect(JSON.stringify(mail)).not.toContain(BUSINESS_EMAIL);
      }
    }
  );

  it("only the four customer templates use flowkoReplyToHeader", () => {
    const dir = path.join(__dirname, "templates");
    const users = readdirSync(dir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => readFileSync(path.join(dir, file), "utf8").includes("flowkoReplyToHeader"))
      .sort();

    expect(users).toEqual([
      "attendee-cancelled-email.ts",
      "attendee-reminder-email.ts",
      "attendee-rescheduled-email.ts",
      "attendee-scheduled-email.ts",
    ]);
  });
});
