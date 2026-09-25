import { _generateMetadata, getTranslate } from "app/_utils";

import OAuthClientsAdminView from "@calcom/web/modules/settings/admin/oauth-clients-admin-view";

import { requireActiveAdmin } from "../../requireActiveAdmin";

const Page = async () => {
  // Flowko: the page checked only for a session and relied on the layout for the admin check, which a partial
  // render can skip. Anyone but an active instance admin now goes to their profile, as the layout sends them.
  await requireActiveAdmin();
  await getTranslate();

  return <OAuthClientsAdminView />;
};

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("oauth_clients_admin"),
    (t) => t("oauth_clients_admin_description"),
    undefined,
    undefined,
    "/settings/admin/oauth"
  );

export default Page;
