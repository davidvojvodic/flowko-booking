import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";

import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
// Flowko U27: the sender name of attendee mails
import { attendeeFromName } from "../lib/flowkoSender";

export default class AttendeeAddGuestsEmail extends AttendeeScheduledEmail {
  async getHtml() {
    return await renderEmail("AttendeeAddGuestsEmail", {
      calEvent: this.calEvent,
      attendee: this.attendee,
    });
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      icalEvent: generateIcsFile({
        calEvent: this.calEvent,
        role: GenerateIcsRole.ATTENDEE,
        status: "CONFIRMED",
        t: this.t,
      }),
      to: `${this.attendee.name} <${this.attendee.email}>`,
      // Flowko U27: a business booking's mail comes from the business (E1)
      from: `${attendeeFromName(this.calEvent)} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(this.calEvent),
      subject: `${this.t("guests_added_event_type_subject", {
        eventType: this.calEvent.type,
        name: this.calEvent.team?.name || this.calEvent.organizer.name,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(),
      text: this.getTextBody("new_guests_added"),
    };
  }
}
