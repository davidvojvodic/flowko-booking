import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { redirectIfCalScreensHidden } from "@lib/flowko/calScreensPage";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import OutOfOfficeView from "~/settings/my-account/out-of-office-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("out_of_office"),
    (t) => t("out_of_office_description"),
    undefined,
    undefined,
    "/settings/my-account/out-of-office"
  );

const Page = async () => {
  // Flowko U27: this page had no session read; it needs one for the non-owner member redirect.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  // Flowko U27: a non-owner business member has no Cal screens, only the bookings list.
  await redirectIfCalScreensHidden(session.user.id);

  return <OutOfOfficeView />;
};

export default Page;
