import { withAppDirSsr } from "app/WithAppDirSsr";
import type { PageProps as ServerPageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";

import { buildLegacyCtx } from "@lib/buildLegacyCtx";

import { getServerSideProps } from "@server/lib/auth/login/getServerSideProps";

import { getAuthLangTranslate, renderWithAuthLanguage } from "~/auth/AuthLanguageFrame";
import type { PageProps as ClientPageProps } from "~/auth/login-view";
import Login from "~/auth/login-view";

export const generateMetadata = async ({ searchParams }: ServerPageProps) => {
  const authT = await getAuthLangTranslate(await searchParams);
  return await _generateMetadata(
    (t) => (authT ?? t)("login"),
    (t) => (authT ?? t)("login"),
    undefined,
    undefined,
    "/auth/login"
  );
};

const getData = withAppDirSsr<ClientPageProps>(getServerSideProps);

const ServerPage = async ({ params, searchParams }: ServerPageProps) => {
  const resolvedSearchParams = await searchParams;
  const props = await getData(
    buildLegacyCtx(await headers(), await cookies(), await params, resolvedSearchParams)
  );
  return await renderWithAuthLanguage({
    pathname: "/auth/login",
    searchParams: resolvedSearchParams,
    children: <Login {...props} />,
  });
};

export default ServerPage;
