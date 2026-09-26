"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

// Flowko: one operator, signup closed. Upstream's 404 also offered "The username <path> is still available"
// with a register link (cal.com/signup on cal.com hosts) and cal.com's docs and blog as "Popular pages".
// None of that applies here, so every 404 asks the visitor to check the link or go back, and offers one "home"
// link, never to WEBSITE_URL's cal.com default. Where it goes depends on who is looking, which not-found.tsx
// decides on the server: a signed-in host goes to this app's root (their event types); everyone else, including
// a booker who has no account and a visitor whose session could not be read, goes to the marketing site
// FLOWKO_SITE_URL instead of this app's login page.
const FLOWKO_SITE_URL = "https://flowko.si";

const homeLinkClassName = "font-medium text-base text-emphasis hover:text-subtle";

export function NotFound({ isSignedIn }: { isSignedIn: boolean }) {
  const { t } = useLocale();
  const pathname = usePathname() ?? "";
  const isBookingSuccessPage = pathname.startsWith("/booking");

  useLayoutEffect(() => {
    if (typeof window !== "undefined") {
      window.CalComPageStatus = "404";
    }
  }, []);

  const homeLinkContent = (
    <>
      {t("or_go_back_home")}
      <span aria-hidden="true"> &rarr;</span>
    </>
  );

  return (
    <div className="min-h-screen bg-default px-4" data-testid="404-page">
      <main className="mx-auto max-w-xl pt-16 pb-6 sm:pt-24">
        <div className="text-center">
          <p className="font-semibold text-emphasis text-sm uppercase tracking-wide">{t("error_404")}</p>
          <h1 className="mt-2 font-cal font-extrabold text-4xl text-emphasis sm:text-5xl">
            {isBookingSuccessPage ? t("booking_not_found") : t("page_doesnt_exist")}
          </h1>
          <span className="mt-2 inline-block text-lg">{t("check_spelling_mistakes_or_go_back")}</span>
        </div>
        <div className="mt-12">
          <div className="mt-8">
            {isSignedIn ? (
              <Link href="/" className={homeLinkClassName}>
                {homeLinkContent}
              </Link>
            ) : (
              <a href={FLOWKO_SITE_URL} className={homeLinkClassName}>
                {homeLinkContent}
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
