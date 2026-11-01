import { withAppDirSsr } from "app/WithAppDirSsr";
import type { PageProps as ServerPageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";

import { buildLegacyCtx } from "@lib/buildLegacyCtx";

import { getServerSideProps } from "@server/lib/auth/forgot-password/[id]/getServerSideProps";

import { getAuthLangTranslate, renderWithAuthLanguage } from "~/auth/AuthLanguageFrame";
import type { PageProps as ClientPageProps } from "~/auth/forgot-password/[id]/forgot-password-single-view";
import SetNewUserPassword from "~/auth/forgot-password/[id]/forgot-password-single-view";

export const generateMetadata = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: ServerPageProps["searchParams"];
}) => {
  const authT = await getAuthLangTranslate(await searchParams);
  return await _generateMetadata(
    (t) => (authT ?? t)("reset_password"),
    (t) => (authT ?? t)("change_your_password"),
    undefined,
    undefined,
    `/auth/forgot-password/${(await params).id}`
  );
};

const getData = withAppDirSsr<ClientPageProps>(getServerSideProps);
const ServerPage = async ({ params, searchParams }: ServerPageProps) => {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const context = buildLegacyCtx(await headers(), await cookies(), resolvedParams, resolvedSearchParams);
  const props = await getData(context);

  return await renderWithAuthLanguage({
    pathname: `/auth/forgot-password/${encodeURIComponent(String(resolvedParams.id))}`,
    searchParams: resolvedSearchParams,
    children: <SetNewUserPassword {...props} />,
  });
};

export default ServerPage;
