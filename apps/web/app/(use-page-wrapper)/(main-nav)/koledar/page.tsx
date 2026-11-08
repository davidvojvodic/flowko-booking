// Flowko U28: /koledar, the desk (day and week calendar of every worker). The view itself renders client-only
// (desk-view-client.tsx holds the dynamic import with ssr: false); access is checked in layout.tsx.
import { _generateMetadata, getTranslate } from "app/_utils";
import { DeskViewClient } from "~/flowko-desk/desk-view-client";
import { ShellMainAppDir } from "../ShellMainAppDir";

export const generateMetadata = async () => {
  return await _generateMetadata(
    (t) => t("flowko_desk_title"),
    (t) => t("flowko_desk_subtitle"),
    undefined,
    undefined,
    "/koledar"
  );
};

const Page = async () => {
  const t = await getTranslate();

  return (
    <ShellMainAppDir heading={t("flowko_desk_title")} subtitle={t("flowko_desk_subtitle")}>
      <DeskViewClient />
    </ShellMainAppDir>
  );
};

export default Page;
