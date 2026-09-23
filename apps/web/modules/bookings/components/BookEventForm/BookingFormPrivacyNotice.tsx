import ServerTrans from "@calcom/lib/components/ServerTrans";
import { APP_NAME, WEBSITE_PRIVACY_POLICY_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";

/**
 * On the booking form the app processes the booker's details on behalf of the business being booked,
 * so the booker is pointed to the privacy notice instead of being asked to accept the app's terms.
 * The signup page keeps `signing_up_terms`.
 */
export const BookingFormPrivacyNotice = (): JSX.Element => {
  const { t } = useLocale();

  return (
    <ServerTrans
      t={t}
      i18nKey="booking_form_privacy_notice"
      values={{ appName: APP_NAME }}
      components={{
        1: (
          <Link
            className="text-emphasis hover:underline"
            key="privacy"
            href={`${WEBSITE_PRIVACY_POLICY_URL}`}
            target="_blank">
            Privacy notice
          </Link>
        ),
      }}
    />
  );
};
