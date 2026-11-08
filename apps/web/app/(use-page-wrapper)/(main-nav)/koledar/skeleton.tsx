// Flowko U28: the desk's loading skeleton (heading and subtitle plus an empty grid), as availability/skeleton.tsx.
"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { ShellMainAppDir } from "app/(use-page-wrapper)/(main-nav)/ShellMainAppDir";

export default function KoledarLoader() {
  const { t } = useLocale();

  return (
    <ShellMainAppDir heading={t("flowko_desk_title")} subtitle={t("flowko_desk_subtitle")}>
      <div className="space-y-3" data-testid="flowko-desk-skeleton">
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-64 w-full" />
      </div>
    </ShellMainAppDir>
  );
}
