import slugify from "@calcom/lib/slugify";
import type { z } from "zod";

/** Object.prototype's own property names, lower-cased (the ES ones and Annex B's __proto__ and accessors). */
const OBJECT_PROTOTYPE_NAMES = new Set(
  [
    "constructor",
    "__proto__",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
  ].map((name) => name.toLowerCase())
);

/**
 * Flowko (U13 hardening): event-type slugs that would make the event's pages ambiguous.
 * - "embed", or any slug ending in "embed": `/<user>/embed` is the user's profile embed, so an event type
 *   with that slug has no page of its own; and embed.js (`packages/embeds/embed-core/src/embed.ts`)
 *   appends `/embed` to a cal link only when the link doesn't already end in "embed", so the embed of
 *   `<user>/<...embed>` would load the booking page, which the U13a framing lock keeps out of clients' sites.
 * - "avatar.png": the `/:user/avatar.png` rewrite in next.config.ts takes that path before the booking page.
 * - Flowko (U13 fix pass): the name of anything a plain object inherits (OBJECT_PROTOTYPE_NAMES). The slug is
 *   the embed snippet's namespace, and the loader keeps namespaces in a plain object (`cal.ns = {}`), so for
 *   "constructor" `cal.ns[namespace] || api` finds Object, `a.q.push` throws and the snippet stops there.
 *   Of these names only "constructor" and "__proto__" can be a lowercase slug, but the update and duplicate
 *   inputs are not slugified, so "toString" could be stored as sent and breaks the loader the same way.
 * Compared without case, as the slug is stored and as slugify would store it: the update and duplicate
 * inputs are not slugified server-side, and Next.js matches the framing lock without case.
 */
export function isReservedEventTypeSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return [slug.trim().toLowerCase(), slugify(slug)].some(
    (candidate) =>
      candidate.endsWith("embed") || candidate === "avatar.png" || OBJECT_PROTOTYPE_NAMES.has(candidate)
  );
}

export const RESERVED_EVENT_TYPE_SLUG_MESSAGE =
  'This URL is reserved: it can\'t end in "embed" or be "avatar.png", "constructor" or another name ' +
  "that every JavaScript object has.";

/** A `superRefine` for an input object with an optional `slug`. */
export function refuseReservedEventTypeSlug(input: { slug?: string | null }, ctx: z.RefinementCtx) {
  if (isReservedEventTypeSlug(input.slug)) {
    ctx.addIssue({ code: "custom", path: ["slug"], message: RESERVED_EVENT_TYPE_SLUG_MESSAGE });
  }
}
