import { withAppDirSsr } from "app/WithAppDirSsr";
import type { PageProps as _PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { CustomI18nProvider } from "app/CustomI18nProvider";
import { cookies, headers } from "next/headers";

import { loadTranslations } from "@calcom/i18n/server";

import { getEventTypePageLocale } from "@lib/booking/getBookerPageLocale";
import { buildLegacyCtx } from "@lib/buildLegacyCtx";
import { getServerSideProps } from "@lib/d/[link]/[slug]/getServerSideProps";
import { type PageProps } from "@lib/d/[link]/[slug]/getServerSideProps";

// Flowko (U13 fix pass): the same module as "~/d/[link]/d-type-view"; vitest maps "~" to apps/api/v1, so
// the page's test (apps/web/test/app/private-link-page.test.tsx) can only load it by this name
import Type from "@calcom/web/modules/d/[link]/d-type-view";

export const generateMetadata = async ({ params, searchParams }: _PageProps) => {
  const _params = await params;
  const legacyCtx = buildLegacyCtx(await headers(), await cookies(), _params, await searchParams);
  const pageProps = await getData(legacyCtx);

  const { booking, eventData, isBrandingHidden } = pageProps;
  const rescheduleUid = booking?.uid;

  const profileName = eventData?.profile?.name ?? "";
  const title = eventData?.title ?? "";
  return await _generateMetadata(
    (t) => `${rescheduleUid && !!booking ? t("reschedule") : ""} ${title} | ${profileName}`,
    (t) => `${rescheduleUid ? t("reschedule") : ""} ${title}`,
    isBrandingHidden,
    undefined,
    `/d/${_params.link}/${_params.slug}`
  );
};

const getData = withAppDirSsr<PageProps>(getServerSideProps);
const ServerPage = async ({ params, searchParams }: _PageProps) => {
  const legacyCtx = buildLegacyCtx(await headers(), await cookies(), await params, await searchParams);
  const pageProps = await getData(legacyCtx);

  // Flowko (U13 fix pass): the private link's booking page speaks the event type's language like /:user/:type
  // (U13-25). Without it a booker saw this page in their browser's language and the success page
  // (/booking/<uid>, which follows the event type) in the owner's.
  const locale = await getEventTypePageLocale({
    interfaceLanguage: pageProps.eventData?.interfaceLanguage,
    eventTypeId: pageProps.eventData?.id,
  });
  if (locale) {
    const ns = "common";
    const translations = await loadTranslations(locale, ns);
    return (
      <CustomI18nProvider translations={translations} locale={locale} ns={ns}>
        <Type {...pageProps} />
      </CustomI18nProvider>
    );
  }

  return <Type {...pageProps} />;
};

export default ServerPage;
