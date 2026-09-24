import { _generateMetadata } from "app/_utils";

import { requireActiveAdmin } from "../requireActiveAdmin";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("admin"),
    () => "",
    undefined,
    undefined,
    "/settings/admin"
  );

const Page = async () => {
  // Flowko: the layout's admin check can be skipped on a partial render, so the page checks itself
  await requireActiveAdmin();
  return <h1>Admin index</h1>;
};
export default Page;
