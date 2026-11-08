// Flowko U27: the call-the-business page. A column worker of a business (and the business's hidden mirror event
// types) is booked only by the business itself, so Cal's public pages for them redirect here. It shows the
// business's name, phone (a tel: link) and address, nothing about any customer. No client component: the page is
// plain server markup.
import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { i18n } from "@calcom/i18n/next-i18next.config";
import { getTranslation } from "@calcom/i18n/server";
import { APP_NAME } from "@calcom/lib/constants";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { loadCallPageBusiness } from "@lib/flowko/callPage";
import type { PageProps } from "app/_types";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

// A control character no translation or interpolated value contains: marks where the phone link goes.
const PHONE_MARK = "\u0001";

function toSupportedLocale(locale: string | null | undefined): string | null {
  return locale && i18n.locales.includes(locale) ? locale : null;
}

async function getRequestLocale(): Promise<string> {
  try {
    return toSupportedLocale(await getLocale(buildLegacyRequest(await headers(), await cookies()))) ?? "en";
  } catch {
    return "en";
  }
}

export const generateMetadata = async ({ params }: PageProps): Promise<Metadata> => {
  const { slug } = await params;
  const business = typeof slug === "string" ? await loadCallPageBusiness(slug) : null;
  const t = await getTranslation(await getRequestLocale(), "common");
  return {
    title: business
      ? `${t("flowko_call_title", { name: business.name, interpolation: { escapeValue: false } })} | ${APP_NAME}`
      : APP_NAME,
    robots: { index: false, follow: false },
  };
};

const CallPage = async ({ params }: PageProps) => {
  const { slug } = await params;
  const business = typeof slug === "string" ? await loadCallPageBusiness(slug) : null;
  if (!business) notFound();

  const locale = await getRequestLocale();
  const t = await getTranslation(locale, "common");
  // React escapes the values; i18next must not escape them a second time.
  const raw = { interpolation: { escapeValue: false } };
  const phone = business.phone?.trim() ? business.phone.trim() : null;
  const address = business.address?.trim() ? business.address.trim() : null;
  const [beforePhone, afterPhone] = phone
    ? t("flowko_call_body_phone", { phone: PHONE_MARK, ...raw }).split(PHONE_MARK)
    : ["", ""];

  return (
    <div lang={locale} className="bg-subtle flex min-h-screen flex-col justify-center px-4 py-12">
      <div className="bg-default border-subtle mx-auto w-full max-w-md rounded-md border px-6 py-10 sm:px-10">
        <div data-testid="flowko-call-page">
          <h1 className="text-emphasis text-lg font-semibold leading-6">
            {t("flowko_call_title", { name: business.name, ...raw })}
          </h1>
          <p className="text-default mt-4 text-sm" data-testid="flowko-call-body">
            {phone ? (
              <>
                {beforePhone}
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                  className="text-emphasis font-semibold underline"
                  data-testid="flowko-call-phone">
                  {phone}
                </a>
                {afterPhone}
              </>
            ) : (
              t("flowko_call_body_no_phone", { name: business.name, ...raw })
            )}
          </p>
          {address ? (
            <p className="text-default mt-2 text-sm" data-testid="flowko-call-address">
              {t("flowko_call_address", { address, ...raw })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default CallPage;
