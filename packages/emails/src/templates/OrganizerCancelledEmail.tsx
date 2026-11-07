// Flowko U27: a cancelled business booking's call-the-business line
import { flowkoCancelledCallToAction } from "../components/ManageLink";
import { SchedulingType } from "@calcom/prisma/enums";

import { OrganizerScheduledEmail } from "./OrganizerScheduledEmail";

export const OrganizerCancelledEmail = (props: React.ComponentProps<typeof OrganizerScheduledEmail>) => {
  const t = props.teamMember?.language.translate || props.calEvent.organizer.language.translate;
  const title = "event_request_cancelled";
  const subject = "event_cancelled_subject";
  const isRoundRobin = props.calEvent.schedulingType === SchedulingType.ROUND_ROBIN;
  const subtitle = props.reassigned
    ? isRoundRobin
      ? t("event_reassigned_subtitle")
      : t("event_reassigned_subtitle_generic")
    : "";
  return (
    <OrganizerScheduledEmail
      title={title}
      subtitle={subtitle}
      headerType="xCircle"
      subject={subject}
      // Flowko U27: a business booking keeps the call-the-business line (E2)
      callToAction={flowkoCancelledCallToAction(props.calEvent, t)}
      reassigned={props.reassigned}
      {...props}
    />
  );
};
