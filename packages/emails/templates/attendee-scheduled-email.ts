import { getRichDescription } from "@calcom/lib/CalEventParser";
import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import { getRecipientTimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";
import { default as cloneDeep } from "lodash/cloneDeep";
import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import BaseEmail from "./_base-email";
// Flowko U27: the sender name of attendee mails; Flowko U29a: + the business Reply-To (S6)
import { attendeeFromName, flowkoReplyToHeader } from "../lib/flowkoSender";

export default class AttendeeScheduledEmail extends BaseEmail {
  calEvent: CalendarEvent;
  attendee: Person;
  showAttendees: boolean | undefined;
  t: TFunction;
  // Flowko U27: set by the templates of a booking that no longer stands: a business booking's text then offers
  // only the call-the-business line, no cancel link (E2)
  protected flowkoBookingCancelled = false;

  constructor(calEvent: CalendarEvent, attendee: Person, showAttendees?: boolean | undefined) {
    super();
    let shouldShowAttendees: boolean;
    if (showAttendees !== undefined) {
      shouldShowAttendees = showAttendees;
    } else if (calEvent.seatsPerTimeSlot) {
      shouldShowAttendees = calEvent.seatsShowAttendees ?? false;
    } else {
      shouldShowAttendees = true;
    }

    if (!shouldShowAttendees && calEvent.seatsPerTimeSlot) {
      this.calEvent = cloneDeep(calEvent);
      this.calEvent.attendees = [attendee];
    } else {
      this.calEvent = calEvent;
    }
    this.name = "SEND_BOOKING_CONFIRMATION";
    this.attendee = attendee;
    this.t = attendee.language.translate;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const clonedCalEvent = cloneDeep(this.calEvent);

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
      ...getReplyToHeader(
        this.calEvent,
        this.calEvent.attendees.filter(({ email }) => email !== this.attendee.email).map(({ email }) => email)
      ),
      // Flowko U29a: a business booking's customer mail answers to the business e-mail when set (S6)
      ...flowkoReplyToHeader(this.calEvent),
      subject: `${this.calEvent.title}`,
      html: await this.getHtml(clonedCalEvent, this.attendee),
      text: this.getTextBody(),
    };
  }

  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeScheduledEmail", {
      calEvent,
      attendee,
    });
  }

  protected getTextBody(title = "", subtitle = "emailed_you_and_any_other_attendees"): string {
    return `
${this.t(
  title
    ? title
    : this.calEvent.recurringEvent?.count
      ? "your_event_has_been_scheduled_recurring"
      : "your_event_has_been_scheduled"
)}
${this.t(subtitle)}

${this.t("when")}: ${this.getFormattedDate()}
${getRichDescription(this.calEvent, this.t, false, { bookingCancelled: this.flowkoBookingCancelled })}
`.trim();
  }

  protected getTimezone(): string {
    return this.attendee.timeZone;
  }

  protected getLocale(): string {
    return this.attendee.language.locale;
  }

  protected getInviteeStart(format: string) {
    return this.getFormattedRecipientTime({
      time: this.calEvent.startTime,
      format,
    });
  }

  protected getInviteeEnd(format: string) {
    return this.getFormattedRecipientTime({
      time: this.calEvent.endTime,
      format,
    });
  }

  public getFormattedDate() {
    const inviteeTimeFormat = getRecipientTimeFormat(this.calEvent.organizer.timeFormat, this.getLocale());

    return `${this.getInviteeStart(inviteeTimeFormat)} - ${this.getInviteeEnd(
      inviteeTimeFormat
    )}, ${this.getFormattedRecipientDate(this.calEvent.startTime)}`;
  }
}
