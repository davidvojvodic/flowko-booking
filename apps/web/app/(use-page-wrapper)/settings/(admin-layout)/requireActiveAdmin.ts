import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { isActiveInstanceAdminSession } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import prisma from "@calcom/prisma";
import { UserPermissionRole } from "@calcom/prisma/enums";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

/**
 * Flowko: the admin check of the admin settings pages. The (admin-layout) layout is not a security boundary:
 * on an RSC partial render Next.js does not re-run a layout whose segment matches the client-sent
 * Next-Router-State-Tree header, so every page, and every generateMetadata that reads data, checks itself.
 *
 * Returns the session of an active instance admin, or null. The session role comes from the database, so it
 * still says ADMIN for an admin whom validateRole signed in as INACTIVE_ADMIN (no 2FA, weak password): the
 * user row and the JWT sign-in role must both pass isActiveInstanceAdminSession.
 */
export async function getActiveAdminSession() {
  const req = buildLegacyRequest(await headers(), await cookies());
  const session = await getServerSession({ req });
  if (!session || session.user?.role !== UserPermissionRole.ADMIN) return null;
  const user = await new UserRepository(prisma).findUnlockedUserForSession({ userId: session.user.id });
  if (!(await isActiveInstanceAdminSession(user, req))) return null;
  return session;
}

/**
 * Flowko: anyone but an active instance admin is sent to their profile, exactly as the admin layout sends
 * them. Call it before any data access or data-bearing render.
 */
export async function requireActiveAdmin() {
  const session = await getActiveAdminSession();
  if (!session) return redirect("/settings/my-account/profile");
  return session;
}
