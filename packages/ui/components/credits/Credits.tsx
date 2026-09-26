"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CALCOM_VERSION, COMPANY_NAME, IS_SELF_HOSTED } from "@calcom/lib/constants";

// Flowko: the company line links to Flowko's website. Upstream linked it to https://go.cal.com/credits
const FLOWKO_SITE_URL = "https://flowko.si";

// eslint-disable-next-line turbo/no-undeclared-env-vars
const vercelCommitHash = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
const commitHash = vercelCommitHash ? `-${vercelCommitHash.slice(0, 7)}` : "";
const CalComVersion = `v.${CALCOM_VERSION}-${!IS_SELF_HOSTED ? "h" : "sh"}`;

export default function Credits() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return (
    <small className="text-default mx-3 mb-2 mt-1 hidden text-[0.5rem] opacity-50 lg:block">
      &copy; {new Date().getFullYear()}{" "}
      <Link href={FLOWKO_SITE_URL} target="_blank" className="hover:underline">
        {COMPANY_NAME}
      </Link>{" "}
      {/* Flowko: the version and the commit are plain text. Upstream linked the version to
          https://go.cal.com/releases and, on cal.com, the commit to calcom's GitHub repository */}
      {hasMounted && (
        <span>
          {CalComVersion}
          {commitHash}
        </span>
      )}
    </small>
  );
}
