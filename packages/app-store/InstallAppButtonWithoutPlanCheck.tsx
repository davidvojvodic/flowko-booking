"use client";

import type { UseAddAppMutationOptions } from "@calcom/app-store/_utils/useAddAppMutation";
import useAddAppMutation from "@calcom/app-store/_utils/useAddAppMutation";
import { deriveAppDictKeyFromType } from "@calcom/lib/deriveAppDictKeyFromType";
import type { App } from "@calcom/types/App";

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
  const mutation = useAddAppMutation(null, props.options);
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
