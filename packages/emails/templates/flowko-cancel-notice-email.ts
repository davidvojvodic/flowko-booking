// Flowko U29e: the business notice when a customer cancels a booking through the link in their mail (E7, R13). The
// mail goes to the business e-mail, or to the owner's login e-mail when none is set (decided by the service, which
// sets `ownerFallback`); it comes from the product (From display name = EMAIL_FROM_NAME, as Cal's organizer mails:
// Flowko informs the salon) and answers to the customer when they have a real address (no Reply-To otherwise). It
// names the customer, the services, the worker, the business-local time and the reason, and links to the desk day;
// never the booking's uid or a cancel link. Slovene explicitly (the business has no locale field). Sent with
// `sendEmailOrThrow` only (see `sendFlowkoCancelNoticeEmail`): the service logs every outcome other than "sent".
import type { TFunction } from "i18next";

import { getTranslation } from "@calcom/i18n/server";
import { EMAIL_FROM_NAME } from "@calcom/lib/constants";

import renderEmail from "../src/renderEmail";
import BaseEmail from "./_base-email";

export type FlowkoCancelNoticeMail = {
  /** The address only: no display name. */
  to: string;
  /** The customer's real e-mail; null = no Reply-To and no reply line. */
  replyTo: string | null;
  /** Raw (never HTML-escaped here). */
  customerName: string;
  /** null = no phone line. */
  customerPhone: string | null;
  /** Distinct, in step order. */
  serviceNames: string[];
  /** The worker's current Flowko name. */
  workerName: string;
  /** Business-local, Slovene, with the year: „pon., 23. 11. 2026“. */
  date: string;
  /** Business-local „HH:mm“. */
  start: string;
  end: string;
  /** The stored cancellation reason (may span lines); null = „no reason given“. */
  reason: string | null;
  /** `${WEBAPP_URL}/koledar?view=day&date=YYYY-MM-DD`. */
  dayUrl: string;
  /** true = the business has no e-mail, so the notice goes to the owner's login e-mail (one more footer line). */
  ownerFallback: boolean;
};

/** The service always sends "sl"; "en" exists so both translation files are exercised. */
export type FlowkoCancelNoticeLocale = "sl" | "en";

/** Every string that carries a name, the reason or a date: React escapes it once in HTML, the text stays raw. */
const RAW = { interpolation: { escapeValue: false } } as const;

export default class FlowkoCancelNoticeEmail extends BaseEmail {
  notice: FlowkoCancelNoticeMail;
  locale: FlowkoCancelNoticeLocale;

  constructor(notice: FlowkoCancelNoticeMail, locale: FlowkoCancelNoticeLocale = "sl") {
    super();
    this.name = "FLOWKO_CANCEL_NOTICE_EMAIL";
    this.notice = notice;
    this.locale = locale;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const { to, replyTo } = this.notice;
    const t = await getTranslation(this.locale, "common");
    const subject = t("flowko_cancel_notice_subject", {
      customer: this.notice.customerName,
      date: this.notice.date,
      time: this.notice.start,
      ...RAW,
    });
    return {
      to,
      from: `${EMAIL_FROM_NAME} <${this.getMailerOptions().from}>`,
      ...(replyTo ? { replyTo } : {}),
      subject,
      html: await renderEmail("FlowkoCancelNoticeEmail", { language: t, subject, ...this.notice }),
      text: this.getTextBody(t),
    };
  }

  protected getTextBody(t: TFunction): string {
    const n = this.notice;
    const line = (key: string, value: string) => `${t(key)}: ${value}`;
    const details = [
      line("flowko_cancel_notice_customer", n.customerName),
      ...(n.customerPhone ? [line("flowko_cancel_notice_phone", n.customerPhone)] : []),
      line("flowko_cancel_notice_services", n.serviceNames.join(", ")),
      line("flowko_cancel_notice_worker", n.workerName),
      line(
        "flowko_cancel_notice_when",
        t("flowko_cancel_notice_when_value", { date: n.date, start: n.start, end: n.end, ...RAW })
      ),
      n.reason !== null ? line("flowko_cancel_notice_reason", n.reason) : t("flowko_cancel_notice_no_reason"),
    ].join("\n");
    return [
      t("flowko_cancel_notice_heading"),
      details,
      `${t("flowko_cancel_notice_open_day")}: ${n.dayUrl}`,
      ...(n.replyTo ? [t("flowko_cancel_notice_reply_hint")] : []),
      t("flowko_cancel_notice_footer"),
      ...(n.ownerFallback ? [t("flowko_cancel_notice_footer_fallback")] : []),
    ].join("\n\n");
  }
}
