import dayjs from "@calcom/dayjs";
import "@calcom/dayjs/locales";
import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { i18n } from "@calcom/i18n/next-i18next.config";
import { getTranslation } from "@calcom/i18n/server";
import { APP_NAME } from "@calcom/lib/constants";
import { getTimeFormatStringFromUserTimeFormat } from "@calcom/lib/timeFormat";
import { BookingStatus } from "@calcom/prisma/enums";
// Flowko (U8f): the same module as "~/bookings/views/organizer-link-view"; vitest maps "~" to apps/api/v1
import OrganizerLinkView from "@calcom/web/modules/bookings/views/organizer-link-view";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { PageProps } from "app/_types";
import { DirectAction, REJECTION_REASON_MAX_LENGTH, resolveOrganizerLink } from "app/api/link/organizerLink";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

/**
 * Flowko (U8f, David 2026-09-28): the page the organizer's e-mailed confirm/reject link opens (GET /api/link
 * redirects here). Opening it changes nothing, so a mail scanner that prefetches the link decides nothing; only
 * the button POSTs to /api/link. It checks the link exactly as the POST does and shows the booking's title and
 * time, which the request e-mail already showed, in the organizer's language, time zone and clock.
 * Framing: the default lock applies (`frame-ancestors 'self'`), so no other site can frame the button.
 */

function toSupportedLocale(locale: string | null | undefined): string | null {
  return locale && i18n.locales.includes(locale) ? locale : null;
}

async function getRequestLocale(): Promise<string> {
  try {
    return toSupportedLocale(await getLocale(buildLegacyRequest(await headers(), await cookies()))) ?? "en";
  } catch {
    return "en";
  }
}

/** The booking's time as the request e-mail writes it (WhenInfo): "dddd, LL | <clock> - <clock> (<zone>)". */
function formatWhen(start: Date, end: Date, timeZone: string, locale: string, timeFormat: string): string {
  const format = (zone: string) => {
    const from = dayjs(start).tz(zone).locale(locale);
    const to = dayjs(end).tz(zone).locale(locale);
    return `${from.format(`dddd, LL | ${timeFormat}`)} - ${to.format(timeFormat)} (${zone})`;
  };
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslation(await getRequestLocale(), "common");
  return {
    title: `${t("flowko_link_page_title")} | ${APP_NAME}`,
    // The URL carries the link's token: keep it out of search engines and out of Referer headers.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
};

const OrganizerLinkPage = async ({ searchParams }: PageProps) => {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : undefined;
  const action = typeof query.action === "string" ? query.action : undefined;
  const link = token && action ? await resolveOrganizerLink({ token, action }) : null;

  // NAR-1: one message for every invalid link (expired, altered, incomplete, another organizer's booking).
  if (!link) {
    const locale = await getRequestLocale();
    const t = await getTranslation(locale, "common");
    return (
      <OrganizerLinkView
        lang={locale}
        heading={t("flowko_link_invalid_heading")}
        description={t("flowko_link_invalid_description")}
        link={{ href: "/bookings/unconfirmed", label: t("flowko_link_invalid_button") }}
      />
    );
  }

  const { booking, user } = link;
  const locale = toSupportedLocale(user.locale) ?? (await getRequestLocale());
  const t = await getTranslation(locale, "common");
  const details = {
    whatLabel: t("what"),
    title: booking.title,
    whenLabel: t("when"),
    when: formatWhen(
      booking.startTime,
      booking.endTime,
      user.timeZone,
      locale,
      getTimeFormatStringFromUserTimeFormat(user.timeFormat)
    ),
  };

  // U8e: only a pending booking can be decided through the link; any other status is shown, not changed.
  if (booking.status !== BookingStatus.PENDING) {
    return (
      <OrganizerLinkView
        lang={locale}
        heading={t("flowko_link_decided_heading")}
        description={t("flowko_link_decided_description")}
        details={details}
        link={{ href: `/booking/${booking.uid}`, label: t("view_booking") }}
      />
    );
  }

  const isReject = link.action === DirectAction.REJECT;
  return (
    <OrganizerLinkView
      lang={locale}
      heading={t(isReject ? "flowko_link_reject_heading" : "flowko_link_accept_heading")}
      description={t(isReject ? "flowko_link_reject_description" : "flowko_link_accept_description")}
      details={details}
      form={{
        action: link.action,
        token: link.token,
        submitLabel: t(isReject ? "flowko_link_reject_button" : "flowko_link_accept_button"),
        reasonLabel: isReject ? t("flowko_link_reason_label") : undefined,
        reasonMaxLength: isReject ? REJECTION_REASON_MAX_LENGTH : undefined,
      }}
    />
  );
};

export default OrganizerLinkPage;
