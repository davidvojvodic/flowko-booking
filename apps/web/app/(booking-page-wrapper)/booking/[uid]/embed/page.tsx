import { CustomI18nProvider } from "app/CustomI18nProvider";
import withEmbedSsrAppDir from "app/WithEmbedSSR";
import type { PageProps as ServerPageProps } from "app/_types";
import { cookies, headers } from "next/headers";

import { loadTranslations } from "@calcom/i18n/server";

import { getEventTypePageLocale } from "@lib/booking/getBookerPageLocale";
import { buildLegacyCtx } from "@lib/buildLegacyCtx";

import OldPage from "~/bookings/views/bookings-single-view";
import {
  getServerSideProps,
  type PageProps as ClientPageProps,
} from "~/bookings/views/bookings-single-view.getServerSideProps";

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

const getEmbedData = withEmbedSsrAppDir<ClientPageProps>(getServerSideProps);

const ServerPage = async ({ params, searchParams }: ServerPageProps) => {
  const context = buildLegacyCtx(await headers(), await cookies(), await params, await searchParams);
  const props = await getEmbedData(context);

  // Flowko U13-25: the event type's interface language; only with it off (null), the owner's instead of the visitor's browser
  const eventLocale = await getEventTypePageLocale({
    interfaceLanguage: props.eventType?.interfaceLanguage,
    eventTypeId: props.eventType?.id,
  });
  if (eventLocale) {
    const ns = "common";
    const translations = await loadTranslations(eventLocale, ns);
    return (
      <CustomI18nProvider translations={translations} locale={eventLocale} ns={ns}>
        <OldPage {...props} />
      </CustomI18nProvider>
    );
  }

  return <OldPage {...props} />;
};

export default ServerPage;
