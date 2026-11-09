// Flowko U29a: /settings/podjetje/profil (S15), owner only (the guard runs here, per page). The form is the client
// view BusinessProfileView (Task 7a), which reads viewer.flowko.business.settings itself (no server initial data).
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { requireBusinessOwnerPage } from "@lib/flowko/settingsPage";
import { _generateMetadata, getTranslate } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import BusinessProfileView from "~/flowko-settings/business-profile-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("flowko_settings_profile"),
    (t) => t("flowko_settings_profile_description"),
    undefined,
    undefined,
    "/settings/podjetje/profil"
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
      title={t("flowko_settings_profile")}
      description={t("flowko_settings_profile_description")}
      borderInShellHeader={true}>
      <BusinessProfileView />
    </SettingsHeader>
  );
};

export default Page;
