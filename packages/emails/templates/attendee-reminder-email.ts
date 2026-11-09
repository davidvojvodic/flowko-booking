import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
// Flowko U27: the sender name of attendee mails; Flowko U29a: + the business Reply-To (S6)
import { attendeeFromName, flowkoReplyToHeader } from "../lib/flowkoSender";

/**
 * Flowko U22: the reminder before an accepted booking, to the booker only. No .ics: the confirmation's is
 * METHOD:REQUEST and would read as an updated invitation. Replies go to the organiser, never to the guests.
 */
export default class AttendeeReminderEmail extends AttendeeScheduledEmail {
  name = "SEND_ATTENDEE_REMINDER";

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      to: `${this.attendee.name} <${this.attendee.email}>`,
      // Flowko U27: a business booking's mail comes from the business (E1)
      from: `${attendeeFromName(this.calEvent)} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(this.calEvent),
      // Flowko U29a: a business booking's customer mail answers to the business e-mail when set (S6)
      ...flowkoReplyToHeader(this.calEvent),
      subject: this.t("flowko_reminder_subject", {
        eventType: this.calEvent.type,
        date: this.getFormattedDate(),
      }),
      html: await renderEmail("AttendeeReminderEmail", {
        calEvent: this.calEvent,
        attendee: this.attendee,
      }),
      text: this.getTextBody("flowko_reminder_title", "flowko_reminder_subtitle"),
    };
  }
}
