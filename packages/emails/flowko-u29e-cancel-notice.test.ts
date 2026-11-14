/**
 * Flowko U29e Task 6 (E7, R13): the business notice when a customer cancels through the link in their mail.
 * To = the address only (business e-mail or the owner's login e-mail, decided by the service), From display =
 * EMAIL_FROM_NAME (the product informs the salon), Reply-To = the customer's real address or none (then no reply
 * line), Slovene (the service always sends "sl"; "en" only proves the keys exist in both files). Real translations
 * and templates; only the database and the mail transport are out (INTEGRATION_TEST_MODE collects the payloads in
 * globalThis.testEmails).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { EMAIL_FROM_NAME } from "@calcom/lib/constants";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendFlowkoCancelNoticeEmail } from "./email-manager";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = async () => false;
  },
}));
vi.mock("@calcom/features/flags/operations/check-if-user-has-feature.controller", () => ({
  checkIfUserHasFeatureController: vi.fn(async () => false),
}));

type Mail = { to: string; from: string; replyTo?: string; subject: string; html: string; text: string };

const load = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(__dirname, `../i18n/locales/${lang}/common.json`), "utf8"));
const en = load("en");
const sl = load("sl");

const mails = () => (globalThis.testEmails ?? []) as unknown as Mail[];
const lastMail = () => mails()[mails().length - 1];

// The text is checked against the visible sentence: tags out (a label and its value sit in two elements), then
// HTML entity escaping undone.
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const DAY_URL = "https://booking.example.com/koledar?view=day&date=2026-11-23";
const ARGS = {
  to: "salon@frizerstvo-co.si",
  replyTo: "ana.maja@example.si" as string | null,
  customerName: "Ana & Maja",
  customerPhone: "041 123 456" as string | null,
  serviceNames: ["Žensko striženje", "Moško striženje"],
  workerName: "Bor",
  date: "pon., 23. 11. 2026",
  start: "10:00",
  end: "11:15",
  reason: "Zbolela sem." as string | null,
  dayUrl: DAY_URL,
  ownerFallback: false,
};

const STRINGS = {
  sl: {
    subject: "Stranka je odpovedala termin: Ana & Maja, pon., 23. 11. 2026 ob 10:00",
    heading: "Stranka je odpovedala termin",
    customer: "Stranka: Ana & Maja",
    phone: "Telefon: 041 123 456",
    services: "Storitve: Žensko striženje, Moško striženje",
    worker: "Delavec: Bor",
    when: "Termin: pon., 23. 11. 2026, 10:00–11:15",
    reason: "Razlog: Zbolela sem.",
    noReason: "Razlog ni naveden.",
    openDay: "Odpri dan na koledarju",
    reply: "Na to sporočilo lahko odgovorite in odgovor prejme stranka.",
    footer: "To obvestilo pošlje Flowko, ker je stranka termin odpovedala prek povezave v e-pošti.",
    fallback:
      "Obvestilo prejemate na naslov, s katerim se prijavljate, ker v nastavitvah podjetja ni vpisana e-pošta podjetja.",
  },
  en: {
    subject: "A customer cancelled a booking: Ana & Maja, pon., 23. 11. 2026 at 10:00",
    heading: "A customer cancelled a booking",
    customer: "Customer: Ana & Maja",
    phone: "Phone: 041 123 456",
    services: "Services: Žensko striženje, Moško striženje",
    worker: "Worker: Bor",
    when: "Booking: pon., 23. 11. 2026, 10:00–11:15",
    reason: "Reason: Zbolela sem.",
    noReason: "No reason given.",
    openDay: "Open the day in the calendar",
    reply: "You can reply to this message and the reply goes to the customer.",
    footer:
      "Flowko sends this notice because the customer cancelled the booking through the link in their e-mail.",
    fallback:
      "You get this notice at the address you sign in with, because no business e-mail is set in the business settings.",
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

describe.each(["sl", "en"] as const)("U29e cancel notice in %s", (locale) => {
  const s = STRINGS[locale];

  it("goes to the address only, from the product name, answering to the customer", async () => {
    const outcome = await sendFlowkoCancelNoticeEmail(ARGS, locale);

    expect(outcome).toBe("skipped_test_mode");
    expect(mails()).toHaveLength(1);
    const mail = lastMail();
    expect(mail.to).toBe("salon@frizerstvo-co.si");
    expect(mail.from.startsWith(`${EMAIL_FROM_NAME} <`)).toBe(true);
    expect(mail.replyTo).toBe("ana.maja@example.si");
    // „&“ once: no entity in the subject (deliver decodes it only on a real send)
    expect(mail.subject).toBe(s.subject);
  });

  it("has no Reply-To and no reply line when the customer has no real address", async () => {
    await sendFlowkoCancelNoticeEmail({ ...ARGS, replyTo: null }, locale);

    const mail = lastMail();
    expect(mail).not.toHaveProperty("replyTo");
    expect(plain(mail.html)).not.toContain(s.reply);
    expect(mail.text).not.toContain(s.reply);
    // everything else is still there
    expect(mail.text).toContain(s.footer);
    expect(plain(mail.html)).toContain(s.footer);
  });

  it("the HTML has the heading, customer, phone, services, worker, time, reason, day link, reply line and footer", async () => {
    await sendFlowkoCancelNoticeEmail(ARGS, locale);

    const { html } = lastMail();
    const text = plain(html);
    for (const line of [
      s.heading,
      s.customer,
      s.phone,
      s.services,
      s.worker,
      s.when,
      s.reason,
      s.openDay,
      s.reply,
      s.footer,
    ]) {
      expect(text).toContain(line);
    }
    // React escapes the & of the query string once
    expect(html).toContain('href="https://booking.example.com/koledar?view=day&amp;date=2026-11-23"');
    expect(text).not.toContain(s.noReason);
    expect(text).not.toContain(s.fallback);
  });

  it("the plain text has the same content", async () => {
    await sendFlowkoCancelNoticeEmail(ARGS, locale);

    const { text } = lastMail();
    for (const line of [
      s.heading,
      s.customer,
      s.phone,
      s.services,
      s.worker,
      s.when,
      s.reason,
      s.reply,
      s.footer,
    ]) {
      expect(text).toContain(line);
    }
    expect(text).toContain(`${s.openDay}: ${DAY_URL}`);
    expect(text).not.toContain(s.noReason);
    expect(text).not.toContain(s.fallback);
  });

  it("no phone: no phone line; no reason: „no reason“ instead of the reason line", async () => {
    await sendFlowkoCancelNoticeEmail({ ...ARGS, customerPhone: null, reason: null }, locale);

    const mail = lastMail();
    for (const body of [mail.text, plain(mail.html)]) {
      expect(body).not.toContain(s.phone.split(":")[0]);
      expect(body).toContain(s.noReason);
      expect(body).not.toContain(s.reason);
    }
  });

  it("the owner fallback adds the fallback footer line", async () => {
    await sendFlowkoCancelNoticeEmail({ ...ARGS, ownerFallback: true }, locale);

    const mail = lastMail();
    expect(mail.text).toContain(s.fallback);
    expect(plain(mail.html)).toContain(s.fallback);
    expect(mail.text).toContain(s.footer);
  });

  it("a multi-line reason is kept line by line", async () => {
    await sendFlowkoCancelNoticeEmail({ ...ARGS, reason: "Prva vrstica\nDruga vrstica\n\nTretja" }, locale);

    const mail = lastMail();
    expect(mail.text).toContain("Prva vrstica\nDruga vrstica\n\nTretja");
    expect(mail.html).toMatch(/Prva vrstica<br\s*\/?>Druga vrstica<br\s*\/?><br\s*\/?>Tretja/);
  });

  it("escapes names and the reason once: no &amp; in the subject or the text, no &amp;amp; in the HTML", async () => {
    await sendFlowkoCancelNoticeEmail(
      {
        ...ARGS,
        customerName: 'Ana "Maja" & <Co>',
        workerName: "Bor & Co",
        serviceNames: ["Striženje & feniranje"],
        reason: "Bolezen & <b>vročina</b>",
      },
      locale
    );

    const mail = lastMail();
    expect(mail.subject).toContain('Ana "Maja" & <Co>');
    expect(mail.subject).not.toContain("&amp;");
    for (const raw of [
      'Ana "Maja" & <Co>',
      "Bor & Co",
      "Striženje & feniranje",
      "Bolezen & <b>vročina</b>",
    ]) {
      expect(mail.text).toContain(raw);
    }
    expect(mail.text).not.toContain("&amp;");
    expect(mail.html).not.toContain("&amp;amp;");
    // React escapes once; no markup from the reason or the name
    expect(mail.html).toContain("Ana &quot;Maja&quot; &amp; &lt;Co&gt;");
    expect(mail.html).toContain("Bolezen &amp; &lt;b&gt;vročina&lt;/b&gt;");
    expect(mail.html).not.toContain("<Co>");
    expect(mail.html).not.toContain("<b>vročina");
  });

  it("carries no uid, no booking page, no cancel link, no placeholder domain and no remote font", async () => {
    await sendFlowkoCancelNoticeEmail(ARGS, locale);

    const mail = lastMail();
    for (const body of [mail.html, mail.text, mail.subject]) {
      expect(body).not.toContain("/booking/");
      expect(body).not.toContain("cancel=true");
      expect(body).not.toContain("flowko.invalid");
      expect(body).not.toContain("uid");
    }
    expect(mail.html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});

describe("U29e cancel notice strings", () => {
  const KEYS = [
    "flowko_cancel_notice_subject",
    "flowko_cancel_notice_heading",
    "flowko_cancel_notice_customer",
    "flowko_cancel_notice_phone",
    "flowko_cancel_notice_services",
    "flowko_cancel_notice_worker",
    "flowko_cancel_notice_when",
    "flowko_cancel_notice_when_value",
    "flowko_cancel_notice_reason",
    "flowko_cancel_notice_no_reason",
    "flowko_cancel_notice_open_day",
    "flowko_cancel_notice_reply_hint",
    "flowko_cancel_notice_footer",
    "flowko_cancel_notice_footer_fallback",
  ] as const;

  it("are in both languages, as written (Slovene per the plan's Keys)", () => {
    expect(sl.flowko_cancel_notice_subject).toBe(
      "Stranka je odpovedala termin: {{customer}}, {{date}} ob {{time}}"
    );
    expect(sl.flowko_cancel_notice_heading).toBe("Stranka je odpovedala termin");
    expect(sl.flowko_cancel_notice_customer).toBe("Stranka");
    expect(sl.flowko_cancel_notice_phone).toBe("Telefon");
    expect(sl.flowko_cancel_notice_services).toBe("Storitve");
    expect(sl.flowko_cancel_notice_worker).toBe("Delavec");
    expect(sl.flowko_cancel_notice_when).toBe("Termin");
    expect(sl.flowko_cancel_notice_when_value).toBe("{{date}}, {{start}}–{{end}}");
    expect(sl.flowko_cancel_notice_reason).toBe("Razlog");
    expect(sl.flowko_cancel_notice_no_reason).toBe("Razlog ni naveden.");
    expect(sl.flowko_cancel_notice_open_day).toBe("Odpri dan na koledarju");
    expect(sl.flowko_cancel_notice_reply_hint).toBe(
      "Na to sporočilo lahko odgovorite in odgovor prejme stranka."
    );
    expect(sl.flowko_cancel_notice_footer).toBe(
      "To obvestilo pošlje Flowko, ker je stranka termin odpovedala prek povezave v e-pošti."
    );
    expect(sl.flowko_cancel_notice_footer_fallback).toBe(
      "Obvestilo prejemate na naslov, s katerim se prijavljate, ker v nastavitvah podjetja ni vpisana e-pošta podjetja."
    );
  });

  it("exist in both files with the same placeholders and use lowercase vi/vaš inside a sentence in Slovene", () => {
    const midSentenceCapital = /(?<![.!?:]\s)(?<!^)\b(Vaš|Vaša|Vaše|Vašo|Vašega|Vaših|Vam|Vas|Vi|Vami)\b/;
    const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(sl[key], key).toBeTruthy();
      expect(placeholders(en[key]), key).toEqual(placeholders(sl[key]));
      expect(sl[key], key).not.toMatch(midSentenceCapital);
    }
  });

  it("the business e-mail hint now names the notices and the fallback (R14)", () => {
    expect(sl.flowko_settings_email_hint).toBe(
      "Na ta naslov prispejo odgovori strank na e-poštna sporočila o terminih in obvestila, ko stranka odpove termin. Če naslov ni vpisan, obvestila o odpovedih prejmete na e-poštni naslov, s katerim se prijavljate."
    );
    expect(en.flowko_settings_email_hint).toBe(
      "Customers' replies to e-mails about their bookings arrive at this address, and so do notices when a customer cancels a booking. If no address is set, cancellation notices go to the e-mail address you sign in with."
    );
    expect(sl.flowko_settings_email_hint).not.toMatch(
      /(?<![.!?:]\s)(?<!^)\b(Vaš|Vaša|Vaše|Vašo|Vašega|Vaših|Vam|Vas|Vi|Vami)\b/
    );
  });
});
