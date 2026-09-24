"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PlaygroundLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isPlaygroundRoot = pathname === "/settings/admin/playground";

  return isPlaygroundRoot ? (
    children
  ) : (
    <div>
      <Link href="/settings/admin/playground" className="text-sm underline">
        ← Playground
      </Link>
      <div className="h-8" />
      <div>{children}</div>
    </div>
  );
}
