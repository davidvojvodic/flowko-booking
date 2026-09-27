import { CustomI18nProvider } from "app/CustomI18nProvider";
import withEmbedSsrAppDir from "app/WithEmbedSSR";
import type { PageProps as ServerPageProps } from "app/_types";
import { cookies, headers } from "next/headers";

import { loadTranslations } from "@calcom/i18n/server";

import { getUserPageLocale } from "@lib/booking/getBookerPageLocale";
import { buildLegacyCtx } from "@lib/buildLegacyCtx";

import { getServerSideProps } from "@server/lib/[user]/getServerSideProps";

import User, { type PageProps as ClientPageProps } from "~/users/views/users-public-view";

export const generateMetadata = async () => {
  return {
    robots: {
      follow: false,
      index: false,
    },
  };
};

const getData = withEmbedSsrAppDir<ClientPageProps>(getServerSideProps);

const ServerPage = async ({ params, searchParams }: ServerPageProps) => {
  const context = buildLegacyCtx(await headers(), await cookies(), await params, await searchParams);
  const props = await getData(context);

  // Flowko U13-25: the user's own language instead of the visitor's browser, as their event types' embeds have
  const locale = await getUserPageLocale(props.profile?.username);
  if (locale) {
    const ns = "common";
    const translations = await loadTranslations(locale, ns);
    return (
      <CustomI18nProvider translations={translations} locale={locale} ns={ns}>
        <User {...props} />
      </CustomI18nProvider>
    );
  }

  return <User {...props} />;
};

export default ServerPage;
