import type { TFunction } from "i18next";

import { WEBAPP_URL } from "@calcom/lib/constants";

import { BaseEmailHtml, CallToAction } from "../components";

/**
 * Flowko: tells a host that a calendar connection stopped working (its grant was revoked or expired), outside
 * any booking. Names nothing but the app: no calendar ids, tokens or other users' data.
 */
export const BrokenCalendarConnectionEmail = (
  props: {
    t: TFunction;
    userName: string | null;
    appName: string;
    /** The host still checks this connection's calendars for conflicts, so their booking page is blocked */
    blocksBookingPage: boolean;
  } & Partial<React.ComponentProps<typeof BaseEmailHtml>>
) => {
  const { t, userName, appName, blocksBookingPage } = props;
  // React escapes the values; i18next must not escape them first
  const raw = { interpolation: { escapeValue: false } };
  const subject = t("broken_calendar_connection_email_subject", { appName, ...raw });

  return (
    <BaseEmailHtml subject={subject} title={subject}>
      <p style={{ fontWeight: 400, lineHeight: "24px" }}>
        {userName ? t("hi_user_name", { name: userName, ...raw }) : t("hi")},
      </p>
      <p style={{ fontWeight: 400, lineHeight: "24px" }}>
        {t("broken_calendar_connection_email_body", { appName, ...raw })}
      </p>
      {blocksBookingPage && (
        <p style={{ fontWeight: 400, lineHeight: "24px" }}>
          {t("broken_calendar_connection_email_no_slots")}
        </p>
      )}
      <p style={{ fontWeight: 400, lineHeight: "24px" }}>{t("broken_calendar_connection_email_reconnect")}</p>
      <CallToAction
        label={t("broken_calendar_connection_email_cta")}
        href={`${WEBAPP_URL}/apps/installed/calendar`}
        endIconName="white-arrow-right"
      />
      <p style={{ fontWeight: 400, lineHeight: "24px", marginTop: "24px" }}>
        {t("broken_calendar_connection_email_remove_old")}
      </p>
    </BaseEmailHtml>
  );
};
