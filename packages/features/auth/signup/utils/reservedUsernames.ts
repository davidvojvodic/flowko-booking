import { i18n } from "@calcom/i18n/next-i18next.config";

/**
 * Flowko (U13 hardening): usernames a user can't take, because the first path segment of a booking page
 * (`/<username>`, `/<username>/<slug>`, `/<username>/<slug>/embed`) would then be claimed by a route of
 * the app. Such a user's pages collide with the route (the route wins), and the framing lock in
 * `apps/web/next.config.ts` (U13a) treats `/<name>/embed` and `/<name>/<slug>/embed` for these names as
 * dashboard paths, so the user's embed would stay unframeable on the client's website.
 *
 * `next.config.ts` builds its list at build time from a scan of `apps/web/app` and `apps/web/pages`
 * (`pagesAndRewritePaths.ts`), which this package can't read at runtime. `apps/web/next.config.headers.test.ts`
 * fails when that scan returns a name missing here, so a new top-level route has to be added below.
 */
const TOP_LEVEL_ROUTES = [
  // `topLevelRoutesExcludedFromOrgRewrite` (the scan) and `topLevelRouteNamesWhitelistedForRewrite`
  "api",
  "apps",
  "auth",
  "availability",
  "booking",
  "booking-successful",
  "bookings",
  "cache",
  "d",
  "e2e",
  "enterprise",
  "event-types",
  "getting-started",
  "icons",
  "maintenance",
  "members",
  "more",
  "onboarding",
  "payment",
  "refer",
  "reschedule",
  "router",
  "settings",
  "signup",
  "upgrade",
  "video",
  // Files directly under apps/web/app that the scan also returns. They are no routes, but the framing
  // lock treats them as such, so a user of that name would have a locked embed.
  "approuteri18nprovider",
  "customi18nprovider",
  "error",
  "geocontext",
  "not-found",
  "not-found.test",
  "notfoundclient",
  "notfoundclient.test",
  "page",
  "providers",
  "providers.test",
  "speculationrules",
];

const OTHER_RESERVED_FIRST_SEGMENTS = [
  // rewrite-only and virtual routes, Next.js paths and the static embed files (next.config.ts headers())
  "forms",
  "success",
  "cancel",
  "app",
  "_next",
  "public",
  "embed",
  "embed.js",
  "login",
  "routing",
  "routing-forms",
  // other rewrite and redirect sources in next.config.ts that would take over a user's pages
  "org",
  "team",
  "_proxy",
  "call",
  "support",
  "404",
  "500",
];

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set(
  [...TOP_LEVEL_ROUTES, ...OTHER_RESERVED_FIRST_SEGMENTS, ...i18n.locales].map((name) => name.toLowerCase())
);

/**
 * True when `username` can't be a username: one of the reserved first segments above or a locale
 * (`sl`, `pt-br`), compared without case because Next.js matches routes and the framing lock without case,
 * or a name ending in "embed". embed.js (`packages/embeds/embed-core/src/embed.ts`) appends `/embed` to a
 * cal link only when the link doesn't already end in "embed", so such a user's profile embed would load
 * the locked profile page instead of `/<username>/embed`.
 */
export function isReservedUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  const name = username.trim().toLowerCase();
  if (!name) return false;
  return RESERVED_USERNAMES.has(name) || name.endsWith("embed");
}

export const RESERVED_USERNAME_MESSAGE = "This username is reserved";
