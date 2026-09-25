import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { _generateMetadata, getTranslate } from "app/_utils";
import UsersAddView from "@calcom/web/modules/users/views/users-add-view";

import { requireActiveAdmin } from "../../../requireActiveAdmin";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("add_new_user"),
    (t) => t("admin_users_add_description"),
    undefined,
    undefined,
    "/settings/admin/users/add"
  );

const Page = async () => {
  // Flowko: the layout's admin check can be skipped on a partial render, so the page checks itself
  await requireActiveAdmin();
  const t = await getTranslate();

  return (
    <SettingsHeader title={t("add_new_user")} description={t("admin_users_add_description")}>
      <UsersAddView />
    </SettingsHeader>
  );
};

export default Page;
