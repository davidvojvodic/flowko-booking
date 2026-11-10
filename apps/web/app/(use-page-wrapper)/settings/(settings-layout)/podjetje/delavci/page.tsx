// Flowko U29c: /settings/podjetje/delavci (W6), owner only (the guard runs here, per page). The list, the lock dialog
// and the add form are the client view WorkersView, which reads viewer.flowko.workers.list itself (no server initial data).
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { requireBusinessOwnerPage } from "@lib/flowko/settingsPage";
import { _generateMetadata, getTranslate } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import WorkersView from "~/flowko-settings/workers-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("flowko_workers_title"),
    (t) => t("flowko_workers_title_description"),
    undefined,
    undefined,
    "/settings/podjetje/delavci"
  );

const Page = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  await requireBusinessOwnerPage(session.user.id);
  const t = await getTranslate();

  return (
    <SettingsHeader
      title={t("flowko_workers_title")}
      description={t("flowko_workers_title_description")}
      borderInShellHeader={true}>
      <WorkersView />
    </SettingsHeader>
  );
};

export default Page;
