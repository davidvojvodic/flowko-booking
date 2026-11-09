// Flowko U29a: the business section is for its owner (S15). The guard runs here, above the pages' loading
// boundaries, so a signed-out visitor goes to the login and anyone else is redirected before the owner's page
// skeleton shows (as koledar/layout.tsx); each page keeps its own guard.
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { requireBusinessOwnerPage } from "@lib/flowko/settingsPage";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function PodjetjeLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  await requireBusinessOwnerPage(session.user.id);

  return <>{children}</>;
}
