// Flowko U29d: the invite mail (E1). A salon owner invites a person into the business: the mail comes from the
// business (From display name = the raw business name; `sanitizeDisplayName` handles specials, so no quoting here),
// answers to the business e-mail when one is set (no Reply-To otherwise, David 12 Nov), and carries the single-use
// link. The recipient has no account yet, so the language is Slovene explicitly. Sent with `sendEmailOrThrow` only
// (see `sendFlowkoInviteEmail`): the invite service maps every outcome other than "sent" to „ni poslano“.
import type { TFunction } from "i18next";

import { getTranslation } from "@calcom/i18n/server";

import renderEmail from "../src/renderEmail";
import BaseEmail from "./_base-email";

export type FlowkoInviteMail = {
  /** The address only: no display name (a typed name could hold an address list). */
  to: string;
  /** The invitee's name, for the greeting. */
  name: string;
  /** The business name, raw (never HTML-escaped here). */
  businessName: string;
  /** The business e-mail; null = no Reply-To and no reply line. */
  replyTo: string | null;
  /** The single-use link; the raw token lives in it and nowhere else. */
  link: string;
  /** Business-local, Slovene, with the year: „pon., 23. 11. 2026“. */
  expiresDate: string;
  /** Business-local „HH:mm“. */
  expiresTime: string;
};

/** The service always sends "sl"; "en" exists so both translation files are exercised. */
export type FlowkoInviteLocale = "sl" | "en";

/** Every string that carries a name or a link: the name is escaped by React / not at all in the text, never twice. */
const RAW = { interpolation: { escapeValue: false } } as const;

export default class FlowkoInviteEmail extends BaseEmail {
  invite: FlowkoInviteMail;
  locale: FlowkoInviteLocale;

  constructor(invite: FlowkoInviteMail, locale: FlowkoInviteLocale = "sl") {
    super();
    this.name = "FLOWKO_INVITE_EMAIL";
    this.invite = invite;
    this.locale = locale;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const { to, name, businessName, replyTo, link, expiresDate, expiresTime } = this.invite;
    const t = await getTranslation(this.locale, "common");
    return {
      to,
      from: `${businessName} <${this.getMailerOptions().from}>`,
      ...(replyTo ? { replyTo } : {}),
      subject: t("flowko_invite_mail_subject", { businessName, ...RAW }),
      html: await renderEmail("FlowkoInviteEmail", {
        language: t,
        name,
        businessName,
        replyTo,
        link,
        expiresDate,
        expiresTime,
      }),
      text: this.getTextBody(t),
    };
  }

  protected getTextBody(t: TFunction): string {
    const { name, businessName, replyTo, link, expiresDate, expiresTime } = this.invite;
    return [
      `${t("hi_user_name", { name, ...RAW })}!`,
      t("flowko_invite_mail_intro", { businessName, ...RAW }),
      `${t("flowko_invite_mail_cta")}: ${link}`,
      t("flowko_invite_mail_expiry", { date: expiresDate, time: expiresTime, ...RAW }),
      t("flowko_invite_mail_ignore"),
      ...(replyTo ? [t("flowko_invite_mail_reply")] : []),
    ].join("\n\n");
  }
}
