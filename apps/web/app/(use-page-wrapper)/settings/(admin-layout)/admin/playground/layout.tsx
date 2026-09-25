import type React from "react";

import { requireActiveAdmin } from "../../requireActiveAdmin";
import PlaygroundLayoutClient from "./PlaygroundLayoutClient";

export default async function PlaygroundLayout({ children }: { children: React.ReactNode }) {
  // Flowko: a server layout, so it can check the admin itself. A partial render can skip it like the admin
  // layout, so each playground page checks too.
  await requireActiveAdmin();

  return <PlaygroundLayoutClient>{children}</PlaygroundLayoutClient>;
}
