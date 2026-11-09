// Flowko U29a: /settings/podjetje, the business section (S15): the owner goes on to the business profile; anyone
// else is redirected by the guard first.
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { requireBusinessOwnerPage } from "@lib/flowko/settingsPage";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

const Page = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  await requireBusinessOwnerPage(session.user.id);

  return redirect("/settings/podjetje/profil");
};

export default Page;
