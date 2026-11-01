"use client";

import type { TFunction } from "i18next";
import { useSession } from "next-auth/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { trpc } from "@calcom/trpc/react";
import { showToast } from "@calcom/ui/components/toast";

interface WebPushContextProps {
  permission: NotificationPermission;
  isLoading: boolean;
  isSubscribed: boolean;
  // Flowko U14: this provider sits above AppRouterI18nProvider (app/layout.tsx), where useLocale has no translations,
  // so the caller, which is inside it, passes its t for the toasts.
  subscribe: (t: TFunction) => Promise<void>;
  unsubscribe: (t: TFunction) => Promise<void>;
}

export const WebPushContext = createContext<WebPushContextProps | null>(null);

interface ProviderProps {
  children: React.ReactNode;
}

export function WebPushProvider({ children }: ProviderProps) {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"
  );
  const [pushManager, setPushManager] = useState<PushManager | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const { mutate: addSubscription } =
    trpc.viewer.loggedInViewerRouter.addNotificationsSubscription.useMutation();
  const { mutate: removeSubscription } =
    trpc.viewer.loggedInViewerRouter.removeNotificationsSubscription.useMutation();

  // Flowko (U13, David 2026-09-27): push notifications are for signed-in hosts, so the service worker is registered
  // only with a session. Visitors, on a booking page opened directly and in an embed on a client's website (whose
  // SessionProvider has session={null}, U13-10), get no service worker in their browser.
  const { status } = useSession();
  const isSignedIn = status === "authenticated";

  useEffect(() => {
    if (!isSignedIn || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/service-worker.js")
      .then(async (registration) => {
        if ("pushManager" in registration) {
          setPushManager(registration.pushManager);
          const subscription = await registration.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
        }
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  }, [isSignedIn]);

  const contextValue = useMemo(
    () => ({
      permission,
      isLoading,
      isSubscribed,
      subscribe: async (t: TFunction) => {
        try {
          setIsLoading(true);
          const newPermission = await Notification.requestPermission();
          setPermission(newPermission);

          if (newPermission === "granted" && pushManager) {
            const subscription = await pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlB64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""),
            });
            addSubscription({ subscription: JSON.stringify(subscription) });
            setIsSubscribed(true);
            showToast(t("notifications_enabled_success"), "success");
          }
        } catch (error) {
          console.error("Failed to subscribe:", error);
          if (
            error instanceof DOMException &&
            error.name === "InvalidAccessError" &&
            error.message.includes("applicationServerKey")
          ) {
            showToast(t("enable_google_services_push"), "error");
          } else {
            showToast(t("notifications_enable_failed"), "error");
          }
        } finally {
          setIsLoading(false);
        }
      },
      unsubscribe: async (t: TFunction) => {
        if (!pushManager) return;
        try {
          setIsLoading(true);
          const subscription = await pushManager.getSubscription();
          if (subscription) {
            const subscriptionJson = JSON.stringify(subscription);
            await subscription.unsubscribe();
            removeSubscription({ subscription: subscriptionJson });
            setIsSubscribed(false);
            showToast(t("notifications_disabled_success"), "success");
          }
        } catch (error) {
          console.error("Failed to unsubscribe:", error);
          showToast(t("notifications_disable_failed"), "error");
        } finally {
          setIsLoading(false);
        }
      },
    }),
    [permission, isLoading, isSubscribed, pushManager, addSubscription, removeSubscription]
  );

  return <WebPushContext.Provider value={contextValue}>{children}</WebPushContext.Provider>;
}

const urlB64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};
