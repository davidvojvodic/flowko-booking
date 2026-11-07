import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
// Flowko U27: the sender name of attendee mails
import { attendeeFromName } from "../lib/flowkoSender";

export default class AttendeeDeclinedEmail extends AttendeeScheduledEmail {
  // Flowko U27: the booking no longer stands (E2)
  protected flowkoBookingCancelled = true;

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      to: `${this.attendee.name} <${this.attendee.email}>`,
      // Flowko U27: a business booking's mail comes from the business (E1)
      from: `${attendeeFromName(this.calEvent)} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(this.calEvent),
      subject: `${this.t("event_declined_subject", {
        title: this.calEvent.title,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(this.calEvent, this.attendee),
      text: this.getDeclinedTextBody(),
    };
  }

  private getDeclinedTextBody(): string {
    if (this.calEvent.recurringEvent?.count) return this.getTextBody("event_request_declined_recurring");
    // U17a (Flowko): a declined reschedule request leaves the customer with no booking; say so
    if (this.calEvent.flowkoPreviousTimeReleased) {
      return this.getTextBody(
        "flowko_reschedule_request_declined",
        "flowko_previous_time_released_book_again"
      );
    }
    return this.getTextBody("event_request_declined");
  }

  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeDeclinedEmail", {
      calEvent,
      attendee,
    });
  }
}
