"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PlaygroundLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isPlaygroundRoot = pathname === "/settings/admin/playground";

  // Flowko: a fragment, so the server layout can render this as a JSX component (children may be undefined)
  return isPlaygroundRoot ? (
    <>{children}</>
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
