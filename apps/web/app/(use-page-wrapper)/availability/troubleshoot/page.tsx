import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { redirectIfCalScreensHidden } from "@lib/flowko/calScreensPage";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import Troubleshoot from "~/availability/troubleshoot/troubleshoot-view";

export const generateMetadata = async () => {
  return await _generateMetadata(
    (t) => t("troubleshoot"),
    (t) => t("troubleshoot_availability"),
    undefined,
    undefined,
    "/availability/troubleshoot"
  );
};

const ServerPage = async () => {
  // Flowko U27: this page had no session read; it needs one for the non-owner member redirect.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }
  // Flowko U27: a non-owner business member has no Cal screens, only the bookings list.
  await redirectIfCalScreensHidden(session.user.id);

  return <Troubleshoot />;
};

export default ServerPage;
