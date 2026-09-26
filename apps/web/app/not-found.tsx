import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { ReadonlyHeaders, ReadonlyRequestCookies } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
// Relative instead of @components/PageWrapperAppDir (the same file): the Vitest config has no @components
// alias, and not-found.test.tsx imports this page.
import PageWrapper from "../components/PageWrapperAppDir";
import { NotFound } from "./notFoundClient";

export const generateMetadata = async () => {
  const metadata = await _generateMetadata(
    (t) => t("404_page_not_found"),
    (t) => t("404_page_not_found")
  );
  return {
    ...metadata,
    robots: {
      index: false,
      follow: false,
    },
  };
};

// Flowko: the 404's home link goes to the event types only for a signed-in host and to https://flowko.si for
// everyone else (see notFoundClient.tsx). A session lookup that fails (no database, a bad token) counts as
// signed out, so the 404 page never fails because of it. headers() and cookies() stay outside the try so
// Next's dynamic-rendering signal is never swallowed.
async function isSignedIn(
  requestHeaders: ReadonlyHeaders,
  requestCookies: ReadonlyRequestCookies
): Promise<boolean> {
  try {
    const session = await getServerSession({ req: buildLegacyRequest(requestHeaders, requestCookies) });
    return Boolean(session?.user?.id);
  } catch {
    return false;
  }
}

const ServerPage = async () => {
  const h = await headers();
  const c = await cookies();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const signedIn = await isSignedIn(h, c);

  return (
    <PageWrapper requiresLicense={false} nonce={nonce}>
      <NotFound isSignedIn={signedIn} />
    </PageWrapper>
  );
};
export default ServerPage;
