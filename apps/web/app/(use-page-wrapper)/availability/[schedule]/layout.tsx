// Flowko U28: the Cal-screen redirect above the loading boundary. The segment's loading.tsx shows its skeleton
// before the page body runs, so a non-owner business member would see Cal's screen first; this layout runs
// before it. The page keeps its own call.
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { redirectIfCalScreensHidden } from "@lib/flowko/calScreensPage";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function ScheduleLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  await redirectIfCalScreensHidden(session.user.id);

  return <>{children}</>;
}
