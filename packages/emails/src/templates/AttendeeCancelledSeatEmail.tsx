// Flowko U27: a cancelled business booking's call-the-business line
import { flowkoCancelledCallToAction } from "../components/ManageLink";
import { AttendeeScheduledEmail } from "./AttendeeScheduledEmail";

export const AttendeeCancelledSeatEmail = (props: React.ComponentProps<typeof AttendeeScheduledEmail>) => (
  <AttendeeScheduledEmail
    title="no_longer_attending"
    headerType="xCircle"
    subject="event_no_longer_attending_subject"
    subtitle=""
    // Flowko U27: a business booking keeps the call-the-business line (E2)
    callToAction={flowkoCancelledCallToAction(props.calEvent, props.attendee.language.translate)}
    {...props}
  />
);
