// Flowko U29a: /settings/podjetje/storitve (S15), owner only (the guard runs here, per page). The list and the editor
// are the client view ServicesView (Task 8), which reads viewer.flowko.services.list itself (no server initial data).
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { requireBusinessOwnerPage } from "@lib/flowko/settingsPage";
import { _generateMetadata, getTranslate } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import ServicesView from "~/flowko-settings/services-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("flowko_settings_services"),
    (t) => t("flowko_settings_services_description"),
    undefined,
    undefined,
    "/settings/podjetje/storitve"
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
      title={t("flowko_settings_services")}
      description={t("flowko_settings_services_description")}
      borderInShellHeader={true}>
      <ServicesView />
    </SettingsHeader>
  );
};

export default Page;
