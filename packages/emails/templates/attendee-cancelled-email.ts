import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
// Flowko U27: the sender name of attendee mails
import { attendeeFromName } from "../lib/flowkoSender";

export default class AttendeeCancelledEmail extends AttendeeScheduledEmail {
  // Flowko U27: the booking no longer stands (E2)
  protected flowkoBookingCancelled = true;

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      icalEvent: generateIcsFile({
        calEvent: this.calEvent,
        role: GenerateIcsRole.ATTENDEE,
        status: "CANCELLED",
        t: this.t,
      }),
      to: `${this.attendee.name} <${this.attendee.email}>`,
      // Flowko U27: a business booking's mail comes from the business (E1)
      from: `${attendeeFromName(this.calEvent)} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(this.calEvent),
      subject: `${this.t("event_cancelled_subject", {
        title: this.calEvent.title,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(this.calEvent, this.attendee),
      text: this.getTextBody("event_request_cancelled", "emailed_you_and_any_other_attendees"),
    };
  }

  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeCancelledEmail", {
      calEvent,
      attendee,
    });
  }
}
