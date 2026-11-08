// Flowko U27: a cancelled business booking's call-the-business line
import { flowkoCancelledCallToAction } from "../components/ManageLink";
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
      // Flowko U27: a business booking keeps the call-the-business line (E2)
      callToAction={flowkoCancelledCallToAction(props.calEvent, props.attendee.language.translate)}
      {...(released && {
        subtitle: <>{props.attendee.language.translate("flowko_previous_time_released_book_again")}</>,
      })}
      {...props}
    />
  );
};
