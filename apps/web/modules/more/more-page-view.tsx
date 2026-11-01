"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";

// Flowko U14: by this name rather than "~/shell", so the page's test loads the same module its mocks replace
import { LanguageSwitcher } from "@calcom/web/modules/shell/LanguageSwitcher";
import { MobileNavigationMoreItems } from "@calcom/web/modules/shell/navigation/Navigation";
import Shell from "@calcom/web/modules/shell/Shell";

export default function MorePage() {
  const { t } = useLocale();
  return (
    <Shell>
      <div className="max-w-(--breakpoint-lg)">
        <MobileNavigationMoreItems />
        <LanguageSwitcher className="mt-4 px-2" />
        <p className="text-subtle mt-6 text-xs leading-tight md:hidden">{t("more_page_footer")}</p>
      </div>
    </Shell>
  );
}
