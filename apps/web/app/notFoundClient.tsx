"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";

// Flowko: one operator, signup closed. Upstream's 404 also offered "The username <path> is still available"
// with a register link (cal.com/signup on cal.com hosts) and cal.com's docs and blog as "Popular pages".
// None of that applies here, so every 404 asks the visitor to check the link or go back, and "home" is this
// app's root (the login page, or the event types once signed in), never WEBSITE_URL's cal.com default.
export function NotFound({ host }: { host: string }) {
  const { t } = useLocale();
  const pathname = usePathname() ?? "";
  const isBookingSuccessPage = pathname.startsWith("/booking");

  useLayoutEffect(() => {
    if (typeof window !== "undefined") {
      window.CalComPageStatus = "404";
    }
  }, []);

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
            <Link href="/" className="font-medium text-base text-emphasis hover:text-subtle">
              {t("or_go_back_home")}
              <span aria-hidden="true"> &rarr;</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
