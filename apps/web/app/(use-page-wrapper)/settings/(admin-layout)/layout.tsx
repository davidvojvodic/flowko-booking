import React from "react";

import SettingsLayoutAppDir from "../(settings-layout)/layout";
import type { AdminLayoutProps } from "./AdminLayoutAppDirClient";
import AdminLayoutAppDirClient from "./AdminLayoutAppDirClient";
import { requireActiveAdmin } from "./requireActiveAdmin";

type AdminLayoutAppDirProps = Omit<AdminLayoutProps, "userRole">;

export default async function AdminLayoutAppDir(props: AdminLayoutAppDirProps) {
  // Flowko: only an active instance admin gets the admin pages (the session role comes from the database, so
  // it still says ADMIN for an admin whom validateRole signed in as INACTIVE_ADMIN). A partial render can skip
  // this layout, so every admin page runs the same check itself.
  const session = await requireActiveAdmin();

  return await SettingsLayoutAppDir({
    children: <AdminLayoutAppDirClient {...props} userRole={session.user.role} />,
  });
}
