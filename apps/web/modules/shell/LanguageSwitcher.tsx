"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import classNames from "@calcom/ui/classNames";
import { showToast } from "@calcom/ui/components/toast";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

const LANGUAGES = ["sl", "en"] as const;

/**
 * Flowko U14: SL / EN in the sidebar and on /more. It changes only this person's screens: the choice goes to
 * `metadata.uiLanguage` and the session, while `User.locale` keeps driving their booking pages and e-mails.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useLocale();
  const { update } = useSession();
  const router = useRouter();

  const mutation = trpc.viewer.me.setUiLanguage.useMutation({
    onSuccess: async ({ locale }) => {
      await update({ locale });
      window.calNewLocale = locale;
      router.refresh();
    },
    onError: () => {
      showToast(t("error_updating_settings"), "error");
    },
  });

  return (
    <div
      role="group"
      aria-label={t("language_switcher_label")}
      className={classNames("flex items-center gap-1 text-sm", className)}>
      {LANGUAGES.map((language, index) => {
        const isActive = i18n.language === language;
        return (
          <span key={language} className="flex items-center gap-1">
            {index > 0 && (
              <span className="text-subtle" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              lang={language}
              aria-pressed={isActive}
              disabled={mutation.isPending}
              onClick={() => {
                if (!isActive) mutation.mutate({ language });
              }}
              className={isActive ? "font-semibold text-(--cal-brand)" : "text-subtle hover:text-emphasis"}>
              {language.toUpperCase()}
            </button>
          </span>
        );
      })}
    </div>
  );
}
