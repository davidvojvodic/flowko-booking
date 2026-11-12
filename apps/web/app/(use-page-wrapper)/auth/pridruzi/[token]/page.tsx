// Flowko U29d (A1, A6, A7, S2): the invitee's page /auth/pridruzi/<token> (under the reserved `auth` segment, so
// /auth/:path* already denies framing). Order: a signed-in visitor gets InviteSignedIn before any token lookup
// (never an accept over another account); then a per-IP limit (a „too many“ view that says nothing about the
// token); then the side-effect-free loader: every unusable token is one InviteInvalid view with the same status
// (200) and no salon, e-mail or person name; an open invite renders the form with the heading and the privacy line
// translated here in Slovene (escapeValue false, React escapes; never ServerTrans). GET never writes, sends or
// signs in (mail scanners open links). Metadata uses the fixed path /auth/pridruzi (never the token), noindex, and
// `referrer: no-referrer` so same-origin fetches (/api/csrf) do not send the URL with the token as Referer.
import type { PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { CustomI18nProvider } from "app/CustomI18nProvider";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { readInviteForAcceptPage } from "@calcom/features/flowkoBusiness/inviteAccept";
import { getTranslation, loadTranslations } from "@calcom/i18n/server";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { HttpError } from "@calcom/lib/http-error";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import prisma from "@calcom/prisma";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

import AcceptView from "~/flowko-invite/accept-view";
import { InviteInvalid, InviteTooMany } from "~/flowko-invite/InviteInvalid";
import { InviteSignedIn } from "~/flowko-invite/InviteSignedIn";

export const dynamic = "force-dynamic";

const PAGE_RATE_LIMIT = { limit: 30, duration: "60s" } as const;
const LOCALE = "sl";

export const generateMetadata = async (): Promise<Metadata> => {
  const metadata = await _generateMetadata(
    (t) => t("flowko_invite_accept_meta_title"),
    (t) => t("flowko_invite_accept_meta_title"),
    undefined,
    undefined,
    "/auth/pridruzi"
  );
  return { ...metadata, robots: { index: false, follow: false }, referrer: "no-referrer" };
};

const AcceptInvitePage = async ({ params }: PageProps) => {
  const req = buildLegacyRequest(await headers(), await cookies());

  const session = await getServerSession({ req });
  if (session?.user) {
    // a signed-in account may speak another language; this page speaks Slovene only
    const translations = await loadTranslations(LOCALE, "common");
    return (
      <CustomI18nProvider translations={translations} locale={LOCALE} ns="common">
        <InviteSignedIn />
      </CustomI18nProvider>
    );
  }

  try {
    await checkRateLimitAndThrowError({
      rateLimitingType: "core",
      identifier: `flowkoInvitePage:${piiHasher.hash(getIP(req))}`,
      opts: { limit: PAGE_RATE_LIMIT },
    });
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 429) return <InviteTooMany />;
    throw error;
  }

  const { token: param } = await params;
  const token = typeof param === "string" ? param : "";
  const invite = await readInviteForAcceptPage(prisma, token, new Date());
  if (invite.state === "invalid") return <InviteInvalid />;

  const t = await getTranslation(LOCALE, "common");
  const withName = { name: invite.businessName, interpolation: { escapeValue: false } };
  return (
    <AcceptView
      token={token}
      email={invite.email}
      name={invite.name}
      title={t("flowko_invite_accept_title", withName)}
      privacy={t("flowko_invite_accept_privacy", withName)}
    />
  );
};

export default AcceptInvitePage;
