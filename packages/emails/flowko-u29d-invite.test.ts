/**
 * Flowko U29d Task 6 (E1): the invite mail. From = the business name (raw), Reply-To = the business e-mail or none,
 * Slovene (the service always sends "sl"; "en" only proves the keys exist in both files), the link, the expiry, the
 * ignore line and, only with a Reply-To, the reply line. Real translations and templates; only the database and the
 * mail transport are out (INTEGRATION_TEST_MODE collects the payloads in globalThis.testEmails).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { INVITE_TTL_MS, inviteExpiry, slInviteDate } from "@calcom/lib/flowkoBusiness/invites";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sendFlowkoInviteEmail } from "./email-manager";

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

// The text is checked against the plain sentence, so HTML entity escaping is undone first.
const plain = (html: string) =>
  html
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

// NOW = Mon 16 Nov 2026 08:07 Ljubljana; the invite expires 7 days later (the real server-side computation).
const NOW = new Date("2026-11-16T07:07:00Z");
const expiry = inviteExpiry(new Date(NOW.getTime() + INVITE_TTL_MS), "Europe/Ljubljana", NOW);
const TOKEN = "Zk3-q9X_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789".slice(0, 43);
const LINK = `https://booking.example.com/auth/pridruzi/${TOKEN}`;
const BUSINESS_NAME = "Frizerstvo & Co";
const REPLY_TO = "info@frizerstvo-co.si";
const ARGS = {
  to: "ana@example.si",
  name: "Ana",
  businessName: BUSINESS_NAME,
  replyTo: REPLY_TO as string | null,
  link: LINK,
  expiresDate: slInviteDate(expiry.expiresDate),
  expiresTime: expiry.expiresTime,
};

const STRINGS = {
  sl: {
    subject: "Povabilo v salon Frizerstvo & Co",
    greeting: "Pozdravljeni, Ana!",
    intro: "Salon Frizerstvo & Co vas vabi, da se pridružite njegovemu koledarju v aplikaciji Flowko.",
    cta: "Sprejmi povabilo",
    expiry: "Povezava velja do pon., 23. 11. 2026 ob 08:07 in deluje samo enkrat.",
    linkText: `Če gumb ne deluje, odprite to povezavo: ${LINK}`,
    ignore: "Če tega povabila niste pričakovali, sporočilo prezrite.",
    reply: "Na to sporočilo lahko odgovorite; odgovor prejme salon.",
  },
  en: {
    subject: "Invitation to Frizerstvo & Co",
    greeting: "Hi Ana!",
    intro: "Frizerstvo & Co invites you to join its calendar in Flowko.",
    cta: "Accept invite",
    expiry: "The link is valid until pon., 23. 11. 2026 at 08:07 and works only once.",
    linkText: `If the button does not work, open this link: ${LINK}`,
    ignore: "If you did not expect this invite, ignore this message.",
    reply: "You can reply to this message; the reply goes to the salon.",
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

describe("U29d invite mail inputs", () => {
  it("the test's expiry is the sl date and the business-local time of NOW + 7 d", () => {
    expect(ARGS.expiresDate).toBe("pon., 23. 11. 2026");
    expect(ARGS.expiresTime).toBe("08:07");
  });
});

describe.each(["sl", "en"] as const)("U29d invite mail in %s", (locale) => {
  const s = STRINGS[locale];

  it("goes to the address only, from the raw business name, answering to the business e-mail", async () => {
    const outcome = await sendFlowkoInviteEmail(ARGS, locale);

    expect(outcome).toBe("skipped_test_mode");
    expect(mails()).toHaveLength(1);
    const mail = lastMail();
    expect(mail.to).toBe("ana@example.si");
    // raw name: no quoting, no &amp;, no stray backslash (sanitizeDisplayName handles specials in production)
    expect(mail.from.startsWith(`${BUSINESS_NAME} <`)).toBe(true);
    expect(mail.from).not.toContain("&amp;");
    expect(mail.from).not.toContain('"');
    expect(mail.from).not.toContain("\\");
    expect(mail.replyTo).toBe(REPLY_TO);
    expect(mail.subject).toBe(s.subject);
  });

  it("has no Reply-To and no reply line when the business has no e-mail", async () => {
    await sendFlowkoInviteEmail({ ...ARGS, replyTo: null }, locale);

    const mail = lastMail();
    expect(mail).not.toHaveProperty("replyTo");
    expect(plain(mail.html)).not.toContain(s.reply);
    expect(mail.text).not.toContain(s.reply);
    // everything else is still there
    expect(mail.text).toContain(s.ignore);
    expect(plain(mail.html)).toContain(s.ignore);
  });

  it("the HTML has the greeting, intro, button, link, expiry, ignore line and reply line", async () => {
    await sendFlowkoInviteEmail(ARGS, locale);

    const html = plain(lastMail().html);
    expect(html).toContain(s.greeting);
    expect(html).toContain(s.intro);
    expect(html).toContain(s.cta);
    expect(lastMail().html).toContain(`href="${LINK}"`);
    expect(html).toContain(s.linkText);
    expect(html).toContain(s.expiry);
    expect(html).toContain(s.ignore);
    expect(html).toContain(s.reply);
  });

  it("the plain text has the same content", async () => {
    await sendFlowkoInviteEmail(ARGS, locale);

    const { text } = lastMail();
    expect(text).toContain(s.greeting);
    expect(text).toContain(s.intro);
    expect(text).toContain(s.cta);
    expect(text).toContain(LINK);
    expect(text).toContain(s.expiry);
    expect(text).toContain(s.ignore);
    expect(text).toContain(s.reply);
  });

  it("escapes the business name once: no &amp; in the subject or the text, no &amp;amp; in the HTML", async () => {
    await sendFlowkoInviteEmail({ ...ARGS, businessName: 'Salon "Ana" & <Co>', name: "Ana & Co" }, locale);

    const mail = lastMail();
    expect(mail.subject).toContain('Salon "Ana" & <Co>');
    expect(mail.text).toContain('Salon "Ana" & <Co>');
    expect(mail.text).toContain("Ana & Co");
    expect(mail.subject).not.toContain("&amp;");
    expect(mail.text).not.toContain("&amp;");
    expect(mail.html).not.toContain("&amp;amp;");
    // React escapes the name for the HTML, once
    expect(mail.html).toContain("Salon &quot;Ana&quot; &amp; &lt;Co&gt;");
    expect(mail.html).not.toContain("<Co>");
  });

  it("loads no remote font", async () => {
    await sendFlowkoInviteEmail(ARGS, locale);

    expect(lastMail().html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it("the token appears only inside the link", async () => {
    await sendFlowkoInviteEmail(ARGS, locale);

    const mail = lastMail();
    expect(mail.html).toContain(TOKEN);
    expect(mail.text).toContain(TOKEN);
    for (const body of [mail.html, mail.text]) {
      expect(body.split(LINK).join("")).not.toContain(TOKEN);
    }
    for (const field of [mail.to, mail.from, mail.subject, mail.replyTo ?? ""]) {
      expect(field).not.toContain(TOKEN);
    }
  });
});

describe("U29d invite mail strings", () => {
  const KEYS = [
    "flowko_invite_mail_subject",
    "flowko_invite_mail_intro",
    "flowko_invite_mail_cta",
    "flowko_invite_mail_expiry",
    "flowko_invite_mail_link_text",
    "flowko_invite_mail_ignore",
    "flowko_invite_mail_reply",
  ] as const;

  it("are in both languages, as written", () => {
    expect(sl.flowko_invite_mail_subject).toBe("Povabilo v salon {{businessName}}");
    expect(sl.flowko_invite_mail_intro).toBe(
      "Salon {{businessName}} vas vabi, da se pridružite njegovemu koledarju v aplikaciji Flowko."
    );
    expect(sl.flowko_invite_mail_cta).toBe("Sprejmi povabilo");
    expect(sl.flowko_invite_mail_expiry).toBe(
      "Povezava velja do {{date}} ob {{time}} in deluje samo enkrat."
    );
    expect(sl.flowko_invite_mail_link_text).toBe("Če gumb ne deluje, odprite to povezavo: {{link}}");
    expect(sl.flowko_invite_mail_ignore).toBe("Če tega povabila niste pričakovali, sporočilo prezrite.");
    expect(sl.flowko_invite_mail_reply).toBe("Na to sporočilo lahko odgovorite; odgovor prejme salon.");
    expect(en.flowko_invite_mail_subject).toBe("Invitation to {{businessName}}");
    expect(en.flowko_invite_mail_intro).toBe("{{businessName}} invites you to join its calendar in Flowko.");
    expect(en.flowko_invite_mail_cta).toBe("Accept invite");
    expect(en.flowko_invite_mail_expiry).toBe(
      "The link is valid until {{date}} at {{time}} and works only once."
    );
    expect(en.flowko_invite_mail_link_text).toBe("If the button does not work, open this link: {{link}}");
    expect(en.flowko_invite_mail_ignore).toBe("If you did not expect this invite, ignore this message.");
    expect(en.flowko_invite_mail_reply).toBe("You can reply to this message; the reply goes to the salon.");
  });

  it("exist in both files and use lowercase vi/vaš inside a sentence in Slovene", () => {
    const midSentenceCapital = /(?<![.!?:]\s)(?<!^)\b(Vaš|Vaša|Vaše|Vašo|Vašega|Vaših|Vam|Vas|Vi|Vami)\b/;
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(sl[key], key).toBeTruthy();
      expect(sl[key], key).not.toMatch(midSentenceCapital);
    }
  });
});
