import { _generateMetadata, getTranslate } from "app/_utils";

import { FlagListingView } from "@calcom/web/modules/feature-flags/views/flag-listing-view";
import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";

import { requireActiveAdmin } from "../../requireActiveAdmin";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("feature_flags"),
    (t) => t("admin_flags_description"),
    undefined,
    undefined,
    "/settings/admin/flags"
  );

const Page = async () => {
  // Flowko: the layout's admin check can be skipped on a partial render, so the page checks itself
  await requireActiveAdmin();
  const t = await getTranslate();
  return (
    <SettingsHeader title={t("feature_flags")} description={t("admin_flags_description")}>
      <FlagListingView />
    </SettingsHeader>
  );
};

export default Page;
