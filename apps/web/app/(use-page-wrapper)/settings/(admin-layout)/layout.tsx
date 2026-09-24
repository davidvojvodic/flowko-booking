import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { isActiveInstanceAdminSession } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import prisma from "@calcom/prisma";
import { UserPermissionRole } from "@calcom/prisma/enums";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

import SettingsLayoutAppDir from "../(settings-layout)/layout";
import type { AdminLayoutProps } from "./AdminLayoutAppDirClient";
import AdminLayoutAppDirClient from "./AdminLayoutAppDirClient";

type AdminLayoutAppDirProps = Omit<AdminLayoutProps, "userRole">;

export default async function AdminLayoutAppDir(props: AdminLayoutAppDirProps) {
  const req = buildLegacyRequest(await headers(), await cookies());
  const session = await getServerSession({ req });
  const userRole = session?.user?.role;

  if (!session || userRole !== UserPermissionRole.ADMIN) {
    return redirect("/settings/my-account/profile");
  }
  // Flowko: the session role comes from the database, so it still says ADMIN for an admin whom validateRole
  // signed in as INACTIVE_ADMIN (no 2FA, weak password). Only an active instance admin gets the admin pages.
  const user = await new UserRepository(prisma).findUnlockedUserForSession({ userId: session.user.id });
  if (!(await isActiveInstanceAdminSession(user, req))) {
    return redirect("/settings/my-account/profile");
  }

  return await SettingsLayoutAppDir({ children: <AdminLayoutAppDirClient {...props} userRole={userRole} /> });
}
