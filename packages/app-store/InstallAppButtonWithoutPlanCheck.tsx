"use client";

import type { UseAddAppMutationOptions } from "@calcom/app-store/_utils/useAddAppMutation";
import useAddAppMutation from "@calcom/app-store/_utils/useAddAppMutation";
import { deriveAppDictKeyFromType } from "@calcom/lib/deriveAppDictKeyFromType";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { App } from "@calcom/types/App";
import { showToast } from "@calcom/ui/components/toast";

import {
  GOOGLE_CALENDAR_APP_TYPE,
  GoogleCalendarConnectGate,
} from "./_components/GoogleCalendarConnectNotice";
import { InstallAppButtonMap } from "./apps.browser.generated";
import type { InstallAppButtonProps } from "./types";

export const InstallAppButtonWithoutPlanCheck = (
  props: {
    type: App["type"];
    options?: UseAddAppMutationOptions;
  } & InstallAppButtonProps
) => {
  const { t } = useLocale();
  // Flowko U9: several connect buttons pass no onError, so a refused connect (the Google Calendar add route's
  // 503) did nothing visible. Without the caller's own onError, show the server's message only when it is the
  // known localised one, and a localised generic message for anything else (it may be raw English)
  const mutation = useAddAppMutation(null, {
    ...props.options,
    onError:
      props.options?.onError ??
      ((error: unknown) => {
        const connectionsUnavailable = t("google_calendar_connections_unavailable");
        showToast(
          error instanceof Error && error.message === connectionsUnavailable
            ? connectionsUnavailable
            : t("app_could_not_be_installed"),
          "error"
        );
      }),
  });
  const key = deriveAppDictKeyFromType(props.type, InstallAppButtonMap);
  const InstallAppButtonComponent = InstallAppButtonMap[key as keyof typeof InstallAppButtonMap];
  if (!InstallAppButtonComponent) {
    const button = props.render({
      useDefaultComponent: true,
      disabled: props.disableInstall,
      onClick: () => {
        mutation.mutate({ type: props.type });
      },
      loading: mutation.data?.setupPending,
    });
    // Google Calendar shows its data-use notice before the redirect to Google's consent screen.
    if (props.type === GOOGLE_CALENDAR_APP_TYPE) {
      return <GoogleCalendarConnectGate>{button}</GoogleCalendarConnectGate>;
    }
    return <>{button}</>;
  }

  return (
    <InstallAppButtonComponent
      render={props.render}
      onChanged={props.onChanged}
      disableInstall={props.disableInstall}
    />
  );
};
