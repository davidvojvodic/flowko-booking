// Flowko U25: business slugs and usernames share one name space. A business slug may not be a reserved
// name (a top-level route, a locale, a name ending in "embed"), any user's username (any case, locked users
// included) or another business's slug; a username may not be a business's slug. Server-only.
import { isReservedUsername } from "@calcom/features/auth/signup/utils/reservedUsernames";
import { isFlowkoSlugShape } from "@calcom/lib/flowkoBusiness/name";
import type { FlowkoDb } from "./db";

export type SlugProblem = "invalid" | "reserved" | "user" | "business";

/** Why `slug` can't be a business slug, or null when it is free. `exceptBusinessId` leaves that business out. */
export async function businessSlugProblem(
  db: Pick<FlowkoDb, "user" | "flowkoBusiness">,
  slug: string,
  exceptBusinessId?: number
): Promise<SlugProblem | null> {
  if (!isFlowkoSlugShape(slug)) return "invalid";
  if (isReservedUsername(slug)) return "reserved";

  const user = await db.user.findFirst({
    // The excludeLockedUsers extension adds locked=false unless the where mentions "locked":
    where: { username: { equals: slug, mode: "insensitive" }, OR: [{ locked: false }, { locked: true }] },
    select: { id: true },
  });
  if (user) return "user";

  const business = await db.flowkoBusiness.findFirst({
    where: { slug, ...(exceptBusinessId !== undefined ? { id: { not: exceptBusinessId } } : {}) },
    select: { id: true },
  });
  if (business) return "business";

  return null;
}

/** True when a business holds `username` as its slug (compared trimmed and lowercase). */
export async function usernameClashesWithBusiness(
  db: Pick<FlowkoDb, "flowkoBusiness">,
  username: string | null | undefined
): Promise<boolean> {
  const slug = username?.trim().toLowerCase();
  if (!slug) return false;
  const business = await db.flowkoBusiness.findFirst({ where: { slug }, select: { id: true } });
  return business !== null && business !== undefined;
}
