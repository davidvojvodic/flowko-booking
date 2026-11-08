// Flowko U27: a cancelled business booking's call-the-business line
import { flowkoCancelledCallToAction } from "../components/ManageLink";
import { AttendeeScheduledEmail } from "./AttendeeScheduledEmail";

export const AttendeeCancelledEmail = (props: React.ComponentProps<typeof AttendeeScheduledEmail>) => (
  <AttendeeScheduledEmail
    title="event_request_cancelled"
    headerType="xCircle"
    subject="event_cancelled_subject"
    // Flowko U27: a business booking keeps the call-the-business line (E2)
    callToAction={flowkoCancelledCallToAction(props.calEvent, props.attendee.language.translate)}
    {...props}
  />
);
