import { AttendeeScheduledEmail } from "./AttendeeScheduledEmail";

const declinedTitle = (isRecurring: boolean, released: boolean) => {
  if (isRecurring) return "event_request_declined_recurring";
  if (released) return "flowko_reschedule_request_declined";
  return "event_request_declined";
};

export const AttendeeDeclinedEmail = (props: React.ComponentProps<typeof AttendeeScheduledEmail>) => {
  const isRecurring = !!props.calEvent.recurringEvent?.count;
  // U17a (Flowko): a declined reschedule request leaves the customer with no booking; say so
  const released = !!props.calEvent.flowkoPreviousTimeReleased && !isRecurring;

  return (
    <AttendeeScheduledEmail
      title={declinedTitle(isRecurring, released)}
      headerType="xCircle"
      subject="event_declined_subject"
      callToAction={null}
      {...(released && {
        subtitle: <>{props.attendee.language.translate("flowko_previous_time_released_book_again")}</>,
      })}
      {...props}
    />
  );
};
