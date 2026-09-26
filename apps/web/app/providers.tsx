"use client";

import { TrpcProvider } from "app/_trpc/trpc-provider";
import { SessionProvider, type SessionProviderProps } from "next-auth/react";
import CacheProvider from "react-inlinesvg/provider";
import { ToastProvider } from "@coss/ui/components/toast";

import { WebPushProvider } from "@calcom/web/modules/notifications/components/WebPushContext";
import { NotificationSoundHandler } from "@calcom/web/components/notification-sound-handler";

import useIsBookingPage from "@lib/hooks/useIsBookingPage";

import { GeoProvider } from "./GeoContext";

/**
 * Flowko U13-10: an embedded booker never asks for the session. isEmbed comes from the root layout, which reads the
 * x-isEmbed header that proxy.ts sets for every path ending in /embed (embed.js always frames such a path), so it is
 * known on the server and on the first client render. A client-side check (useIsEmbed) turns true only after mount,
 * which is after SessionProvider has already fetched. With a known session of null, next-auth skips the initial
 * /api/auth/session request (and so the csrf-token and callback-url cookies that request sets and the
 * nextauth.message entry it writes to localStorage), and nothing refetches on focus or by interval. next-auth still
 * listens for a nextauth.message storage event, which only a same-origin page in the same storage partition can
 * write: on a client's site that is another embed, which never writes one. Bookers never sign in, the booking routes
 * need no session, and pages that are not embeds keep upstream's behaviour.
 */
function getSessionProviderProps(isEmbed: boolean): Omit<SessionProviderProps, "children"> {
  if (!isEmbed) return {};
  return { session: null, refetchOnWindowFocus: false, refetchInterval: 0 };
}

type ProvidersProps = {
  isEmbed: boolean;
  children: React.ReactNode;
  nonce: string | undefined;
  country: string;
};
export function Providers({ isEmbed, children, country }: ProvidersProps) {
  const isBookingPage = useIsBookingPage();

  return (
    <GeoProvider country={country}>
      <SessionProvider {...getSessionProviderProps(isEmbed)}>
        <TrpcProvider>
          <ToastProvider position="bottom-center">
            {!isEmbed && !isBookingPage && <NotificationSoundHandler />}
            {/* @ts-expect-error react-inlinesvg/provider is incompatible with @types/react@18.0.26. Remove when these types are compatible. */}
            <CacheProvider>
              <WebPushProvider>{children}</WebPushProvider>
            </CacheProvider>
          </ToastProvider>
        </TrpcProvider>
      </SessionProvider>
    </GeoProvider>
  );
}
