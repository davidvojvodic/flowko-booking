import type { TFunction } from "i18next";

import { EMAIL_FROM_NAME, WEBAPP_URL } from "@calcom/lib/constants";

import renderEmail from "../src/renderEmail";
import BaseEmail from "./_base-email";

export type BrokenCalendarConnection = {
  /** The host's translations: the e-mail goes out in the host's locale */
  t: TFunction;
  userEmail: string;
  userName: string | null;
  appName: string;
  /** The host still checks this connection's calendars for conflicts, so their booking page is blocked */
  blocksBookingPage: boolean;
};

/**
 * Flowko: BrokenIntegrationEmail needs a booking; this one tells the host, outside any booking, that a
 * calendar connection stopped working and how to reconnect it. BaseEmail.sendEmail applies the "emails"
 * kill switch like for every other e-mail.
 */
export default class BrokenCalendarConnectionEmail extends BaseEmail {
  input: BrokenCalendarConnection;

  constructor(input: BrokenCalendarConnection) {
    super();
    this.name = "SEND_BROKEN_CALENDAR_CONNECTION";
    this.input = input;
  }

  private translate(key: string, values: Record<string, unknown> = {}) {
    // Plain text: i18next must not HTML-escape the values
    return this.input.t(key, { ...values, interpolation: { escapeValue: false } });
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const { t, userEmail, userName, appName, blocksBookingPage } = this.input;
    return {
      from: `${EMAIL_FROM_NAME} <${this.getMailerOptions().from}>`,
      to: userEmail,
      subject: this.translate("broken_calendar_connection_email_subject", { appName }),
      html: await renderEmail("BrokenCalendarConnectionEmail", { t, userName, appName, blocksBookingPage }),
      text: this.getTextBody(),
    };
  }

  protected getTextBody(): string {
    const { userName, appName, blocksBookingPage } = this.input;
    return [
      `${userName ? this.translate("hi_user_name", { name: userName }) : this.translate("hi")},`,
      this.translate("broken_calendar_connection_email_body", { appName }),
      ...(blocksBookingPage ? [this.translate("broken_calendar_connection_email_no_slots")] : []),
      this.translate("broken_calendar_connection_email_reconnect"),
      `${WEBAPP_URL}/apps/installed/calendar`,
      this.translate("broken_calendar_connection_email_remove_old"),
    ].join("\n\n");
  }
}
