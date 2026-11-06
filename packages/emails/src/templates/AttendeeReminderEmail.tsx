import { AttendeeScheduledEmail } from "./AttendeeScheduledEmail";

/**
 * Flowko U22: the reminder the booker gets 24 h and/or 2 h before an accepted booking. The confirmation's layout and
 * manage links, a reminder's title and subtitle. BaseScheduledEmail translates title and subject, not the subtitle.
 */
export const AttendeeReminderEmail = (props: React.ComponentProps<typeof AttendeeScheduledEmail>) => (
  <AttendeeScheduledEmail
    title="flowko_reminder_title"
    subject="flowko_reminder_subject"
    subtitle={<>{props.attendee.language.translate("flowko_reminder_subtitle")}</>}
    {...props}
  />
);
