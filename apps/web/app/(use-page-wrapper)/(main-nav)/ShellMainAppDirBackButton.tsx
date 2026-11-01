"use client";

import { useRouter } from "next/navigation";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";

import type { LayoutProps } from "~/shell/Shell";

export const ShellMainAppDirBackButton = ({ backPath }: { backPath: LayoutProps["backPath"] }) => {
  const router = useRouter();
  const { t } = useLocale();
  return (
    <Button
      variant="icon"
      size="sm"
      color="minimal"
      onClick={() => (typeof backPath === "string" ? router.push(backPath as string) : router.back())}
      StartIcon="arrow-left"
      aria-label={t("go_back")}
      className="rounded-md ltr:mr-2 rtl:ml-2"
      data-testid="go-back-button"
    />
  );
};
