"use client";

import ServerTrans from "@calcom/lib/components/ServerTrans";
import { WEBSITE_PRIVACY_POLICY_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ConfirmationDialogContent, Dialog } from "@calcom/ui/components/dialog";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { cloneElement, createContext, useCallback, useContext, useState } from "react";

/**
 * Google's Workspace API user data policy asks for an in-app disclosure of how calendar data is used
 * right before the user is sent to Google's consent screen. Every way of connecting Google Calendar
 * shows this notice first and continues only when the user confirms it.
 */

type Proceed = () => void;
type RequestConsent = (proceed: Proceed) => void;

export const GOOGLE_CALENDAR_APP_TYPE = "google_calendar";

const GoogleCalendarConnectNoticeContext = createContext<RequestConsent | null>(null);

const GoogleCalendarConnectNoticeDialog = ({
  proceed,
  onClose,
}: {
  proceed: Proceed | null;
  onClose: () => void;
}): JSX.Element => {
  const { t } = useLocale();

  return (
    <Dialog
      open={!!proceed}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      <ConfirmationDialogContent
        title={t("google_connect_atom_label")}
        confirmBtnText={t("continue")}
        cancelBtnText={t("cancel")}
        onConfirm={() => {
          onClose();
          proceed?.();
        }}>
        <p data-testid="google-calendar-connect-notice">
          <ServerTrans
            t={t}
            i18nKey="google_calendar_connect_notice"
            components={[
              <a
                key="privacy"
                className="text-emphasis underline"
                href={`${WEBSITE_PRIVACY_POLICY_URL}`}
                target="_blank"
                rel="noreferrer">
                privacy policy
              </a>,
            ]}
          />
        </p>
      </ConfirmationDialogContent>
    </Dialog>
  );
};

/**
 * `requestConsent(proceed)` opens the notice and calls `proceed` only if the user continues.
 * Render `dialog` somewhere that stays mounted until the user answers.
 */
export const useGoogleCalendarConnectNotice = (): { requestConsent: RequestConsent; dialog: JSX.Element } => {
  const [proceed, setProceed] = useState<Proceed | null>(null);
  const requestConsent = useCallback<RequestConsent>((next) => setProceed(() => next), []);
  const dialog = <GoogleCalendarConnectNoticeDialog proceed={proceed} onClose={() => setProceed(null)} />;
  return { requestConsent, dialog };
};

/**
 * Hosts the notice for install buttons rendered inside something that unmounts when clicked, such as a
 * dropdown menu, so the notice outlives the button.
 */
export const GoogleCalendarConnectNoticeProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const { requestConsent, dialog } = useGoogleCalendarConnectNotice();
  return (
    <GoogleCalendarConnectNoticeContext.Provider value={requestConsent}>
      {children}
      {dialog}
    </GoogleCalendarConnectNoticeContext.Provider>
  );
};

/**
 * Wraps a Google Calendar install button: a click opens the notice, and the button's own click handler
 * runs only once the user continues.
 */
export const GoogleCalendarConnectGate = ({
  children,
}: {
  children: ReactElement<{ onClick?: (event: MouseEvent<HTMLElement>) => void }>;
}): JSX.Element => {
  const requestConsentFromProvider = useContext(GoogleCalendarConnectNoticeContext);
  const notice = useGoogleCalendarConnectNotice();
  const requestConsent = requestConsentFromProvider ?? notice.requestConsent;
  const { onClick } = children.props;

  return (
    <>
      {cloneElement(children, {
        onClick: (event: MouseEvent<HTMLElement>): void => requestConsent(() => onClick?.(event)),
      })}
      {!requestConsentFromProvider && notice.dialog}
    </>
  );
};
