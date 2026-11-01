import type { PageProps as ServerPageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { getCsrfToken } from "next-auth/react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";

import { buildLegacyCtx } from "@lib/buildLegacyCtx";

import { getAuthLangTranslate, renderWithAuthLanguage } from "~/auth/AuthLanguageFrame";
import ForgotPassword from "~/auth/forgot-password/forgot-password-view";

export const generateMetadata = async ({ searchParams }: ServerPageProps) => {
  const authT = await getAuthLangTranslate(await searchParams);
  return await _generateMetadata(
    (t) => (authT ?? t)("forgot_password"),
    (t) => (authT ?? t)("request_password_reset"),
    undefined,
    undefined,
    "/auth/forgot-password"
  );
};

const ServerPage = async ({ params, searchParams }: ServerPageProps) => {
  const resolvedSearchParams = await searchParams;
  const context = buildLegacyCtx(await headers(), await cookies(), await params, resolvedSearchParams);
  const session = await getServerSession({ req: context.req });

  if (session) {
    redirect("/");
  }

  const csrfToken = await getCsrfToken(context);

  return await renderWithAuthLanguage({
    pathname: "/auth/forgot-password",
    searchParams: resolvedSearchParams,
    children: <ForgotPassword csrfToken={csrfToken} />,
  });
};

export default ServerPage;
