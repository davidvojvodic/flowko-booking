import type z from "zod";

import type { GetAppData, SetAppData } from "@calcom/app-store/EventTypeAppContext";
import EventTypeAppContext from "@calcom/app-store/EventTypeAppContext";
import { EventTypeAddonMap } from "@calcom/app-store/apps.browser.generated";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";
import { ErrorBoundary } from "@calcom/ui/components/errorBoundary";

import type { EventTypeAppCardComponentProps, AppCardApp } from "../types";
import { DynamicComponent } from "./DynamicComponent";

export type EventTypeForAppCard = EventTypeAppCardComponentProps["eventType"];

export const EventTypeAppCard = (props: {
  app: AppCardApp;
  eventType: EventTypeForAppCard;
  getAppData: GetAppData;
  setAppData: SetAppData;
  onAppInstallSuccess?: () => void;
  // For event type apps, get these props from shouldLockDisableProps
  LockedIcon?: JSX.Element | false;
  eventTypeFormMetadata: z.infer<typeof EventTypeMetaDataSchema>;
  disabled?: boolean;
}) => {
  const { t } = useLocale();
  const { app, getAppData, setAppData, LockedIcon, disabled, onAppInstallSuccess } = props;
  return (
    <ErrorBoundary message={t("app_card_error", { appName: app.name })}>
      <EventTypeAppContext.Provider value={{ getAppData, setAppData, LockedIcon, disabled }}>
        <DynamicComponent
          slug={app.slug === "stripe" ? "stripepayment" : app.slug}
          componentMap={EventTypeAddonMap}
          {...props}
          onAppInstallSuccess={onAppInstallSuccess}
        />
      </EventTypeAppContext.Provider>
    </ErrorBoundary>
  );
};
