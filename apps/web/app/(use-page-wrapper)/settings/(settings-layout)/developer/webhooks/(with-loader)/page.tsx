import { createRouterCaller } from "app/_trpc/context";
import { _generateMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { isActiveInstanceAdminSession } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { APP_NAME } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import { webhookRouter } from "@calcom/trpc/server/routers/viewer/webhook/_router";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

import WebhooksView from "~/webhooks/views/webhooks-view";

export const generateMetadata = async () =>
  await _generateMetadata(
    (t) => t("webhooks"),
    (t) => t("add_webhook_description", { appName: APP_NAME }),
    undefined,
    undefined,
    "/settings/developer/webhooks"
  );

const WebhooksViewServerWrapper = async () => {
  const req = buildLegacyRequest(await headers(), await cookies());
  const session = await getServerSession({ req });
  if (!session?.user?.id) {
    redirect("/auth/login");
  }
  // Flowko: only an active instance admin may manage webhooks. The session role comes from the database, so
  // it still says ADMIN for an admin whom validateRole signed in as INACTIVE_ADMIN (no 2FA, weak password).
  const user = await new UserRepository(prisma).findUnlockedUserForSession({ userId: session.user.id });
  if (!(await isActiveInstanceAdminSession(user, req))) {
    notFound();
  }

  const caller = await createRouterCaller(webhookRouter);
  const data = await caller.getByViewer();

  return <WebhooksView data={data} />;
};

export default WebhooksViewServerWrapper;
