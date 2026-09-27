import { useIsEmbed } from "@calcom/embed-core/embed-iframe";
import type { BookingResponse } from "@calcom/features/bookings/types";
import { useCompatSearchParams } from "@calcom/lib/hooks/useCompatSearchParams";
import { navigateInTopWindow } from "@calcom/lib/navigateInTopWindow";
import type { EventType } from "@calcom/prisma/client";
import { useRouter } from "next/navigation";

export function getNewSearchParams(args: {
  query: Record<string, string | null | undefined | boolean>;
  searchParams?: URLSearchParams;
  filterInternalParams?: boolean;
}) {
  const { query, searchParams, filterInternalParams = false } = args;
  const newSearchParams = new URLSearchParams();

  // Embed-specific params
  const embedParams = new Set(["embed", "layout", "embedType", "ui.color-scheme"]);

  // Webapp-specific params
  const webappParams = new Set(["overlayCalendar"]);

  // Add non-excluded params from searchParams if provided
  if (searchParams) {
    searchParams.forEach((value, key) => {
      if (shouldExcludeParam(key)) {
        return;
      }
      newSearchParams.append(key, value);
    });
  }

  // Add params from query, filtering excluded params
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return;
    }

    if (shouldExcludeParam(key)) {
      return;
    }

    newSearchParams.append(key, String(value));
  });

  function shouldExcludeParam(key: string) {
    if (filterInternalParams) {
      return embedParams.has(key) || webappParams.has(key);
    }
    return false;
  }

  return newSearchParams;
}

type SuccessRedirectBookingType = Pick<
  BookingResponse,
  "uid" | "title" | "description" | "startTime" | "endTime" | "location" | "attendees" | "user" | "responses"
>;

/**
 * Flowko U13-20: only an http(s) URL is followed. The event type update schema accepts any string, so a stored value
 * could be a javascript: URL or not a URL at all (which made new URL() throw after the booking was made); the booker
 * then gets the booking success page instead.
 */
function toHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const useBookingSuccessRedirect = () => {
  const router = useRouter();
  const searchParams = useCompatSearchParams();
  const isEmbed = useIsEmbed();
  const bookingSuccessRedirect = ({
    successRedirectUrl,
    query,
    booking,
    forwardParamsSuccessRedirect: _forwardParamsSuccessRedirect,
  }: {
    successRedirectUrl: EventType["successRedirectUrl"];
    forwardParamsSuccessRedirect: EventType["forwardParamsSuccessRedirect"];
    query: Record<string, string | null | undefined | boolean>;
    booking: SuccessRedirectBookingType;
  }) => {
    // Ensures that the param is added both to external redirect url and booking success page URL
    query = {
      ...query,
      "cal.rerouting": searchParams.get("cal.rerouting"),
    };

    // Flowko U13-20: the redirect URL is opened as it was saved, whatever forwardParamsSuccessRedirect says. Upstream
    // appended the booker's name, e-mail, phone number and answers, the page's own query (prefilled details
    // included) and the booking's uid, which cancels the booking, to a page on another site, where its analytics
    // and ad tags read them. The event type handlers refuse a new redirect URL (ensureNoSuccessRedirect); this
    // covers event types saved before that.
    const redirectUrl = successRedirectUrl ? toHttpUrl(successRedirectUrl) : null;
    if (redirectUrl) {
      // Using parent ensures, Embed iframe would redirect outside of the iframe.
      navigateInTopWindow(redirectUrl);
      return;
    }

    // TODO: Abstract it out and reuse at other places where we navigate within the embed. Though this is needed only in case of hard navigation happening but we aren't sure where hard navigation happens and where a soft navigation
    // This is specially true after App Router it seems
    const headersRelatedSearchParams = searchParams
      ? {
          "flag.coep": searchParams.get("flag.coep") ?? "false",
        }
      : undefined;

    // We don't want to forward all search params, as they could possibly break the booking page.
    const newSearchParams = getNewSearchParams({
      query,
      searchParams: new URLSearchParams(headersRelatedSearchParams),
    });
    return router.push(`/booking/${booking.uid}${isEmbed ? "/embed" : ""}?${newSearchParams.toString()}`);
  };

  return bookingSuccessRedirect;
};
