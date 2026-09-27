import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { WEBAPP_URL } from "@calcom/lib/constants";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sameSiteParam = url.searchParams.get("sameSite");

  const useSecureCookies = WEBAPP_URL.startsWith("https://");

  // Flowko: "none" is no longer honoured, only "strict" may tighten the default "lax". Upstream's only caller of
  // ?sameSite=none was the cancel form inside an embed (a third-party frame, where Safari and Chrome Incognito
  // refuse the cookie anyway). Since U13-11 that form only runs first-party, and its POST to /api/cancel is
  // same-origin, so it carries a Lax cookie.
  const sameSite: "lax" | "strict" = sameSiteParam === "strict" ? "strict" : "lax";

  const token = randomBytes(32).toString("hex");
  const res = NextResponse.json({ csrfToken: token });

  res.cookies.set("calcom.csrf_token", token, {
    httpOnly: true,
    secure: useSecureCookies,
    sameSite,
    path: "/",
  });

  return res;
}
