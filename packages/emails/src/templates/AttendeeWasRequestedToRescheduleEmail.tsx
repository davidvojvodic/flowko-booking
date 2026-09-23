import { getRecipientTimeFormat } from "@calcom/lib/timeFormat";

import { CallToAction, CallToActionTable } from "../components";
import { OrganizerScheduledEmail } from "./OrganizerScheduledEmail";

export const AttendeeWasRequestedToRescheduleEmail = (
  props: { metadata: { rescheduleLink: string } } & React.ComponentProps<typeof OrganizerScheduledEmail>
) => {
  const t = props.attendee.language.translate;
  return (
    <OrganizerScheduledEmail
      t={t}
      locale={props.attendee.language.locale}
      timeFormat={getRecipientTimeFormat(props.calEvent.organizer.timeFormat, props.attendee.language.locale)}
      title="request_reschedule_booking"
      subtitle={
        <>
          {t("request_reschedule_subtitle", {
            organizer: props.calEvent.organizer.name,
            interpolation: { escapeValue: false },
          })}
        </>
      }
      headerType="calendarCircle"
      subject="rescheduled_event_type_subject"
      callToAction={
        <CallToActionTable>
          <CallToAction label="Book a new time" href={props.metadata.rescheduleLink} endIconName="linkIcon" />
        </CallToActionTable>
      }
      {...props}
    />
  );
};
