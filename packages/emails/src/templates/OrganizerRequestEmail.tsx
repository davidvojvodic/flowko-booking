import { WEBAPP_URL } from "@calcom/lib/constants";
import { LINK_TOKEN_KEY_LABEL, symmetricEncryptAuthenticated } from "@calcom/lib/crypto";

import { CallToAction, Separator, CallToActionTable } from "../components";
import { OrganizerScheduledEmail } from "./OrganizerScheduledEmail";

export const OrganizerRequestEmail = (props: React.ComponentProps<typeof OrganizerScheduledEmail>) => {
  const seedData = {
    bookingUid: props.calEvent.uid,
    userId: props.calEvent.organizer.id,
    platformClientId: props.calEvent.platformClientId,
    platformRescheduleUrl: props.calEvent.platformRescheduleUrl,
    platformCancelUrl: props.calEvent.platformCancelUrl,
    platformBookingUrl: props.calEvent.platformBookingUrl,
    // Flowko: issued-at, so /api/link can expire old links.
    iat: Math.floor(Date.now() / 1000),
  };
  // Flowko: NAR-1. Authenticated (AES-256-GCM) token under a key derived for this purpose only; /api/link
  // refuses anything that does not verify, including the old unauthenticated CBC tokens.
  const token = symmetricEncryptAuthenticated(
    JSON.stringify(seedData),
    process.env.CALENDSO_ENCRYPTION_KEY || "",
    LINK_TOKEN_KEY_LABEL
  );
  //TODO: We should switch to using org domain if available
  const actionHref = `${WEBAPP_URL}/api/link/?token=${encodeURIComponent(token)}`;
  return (
    <OrganizerScheduledEmail
      title={
        props.title || props.calEvent.recurringEvent?.count
          ? "event_awaiting_approval_recurring"
          : "event_awaiting_approval"
      }
      subtitle={<>{props.calEvent.organizer.language.translate("someone_requested_an_event")}</>}
      headerType="calendarCircle"
      subject="event_awaiting_approval_subject"
      callToAction={
        <CallToActionTable>
          <CallToAction
            label={props.calEvent.organizer.language.translate("confirm")}
            href={`${actionHref}&action=accept`}
            startIconName="confirmIcon"
          />
          <Separator />
          <CallToAction
            label={props.calEvent.organizer.language.translate("reject")}
            href={`${actionHref}&action=reject`}
            startIconName="rejectIcon"
            secondary
          />
        </CallToActionTable>
      }
      {...props}
    />
  );
};
