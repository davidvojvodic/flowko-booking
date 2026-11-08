// Flowko U28: the desk is for business members. A signed-out visitor goes to the login, a user with no business
// access (locked, desk-only, stranger) to the bookings list, before any of the desk loads.
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { requireDeskAccess } from "@lib/flowko/deskPage";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function KoledarLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  await requireDeskAccess(session.user.id);

  return <>{children}</>;
}
