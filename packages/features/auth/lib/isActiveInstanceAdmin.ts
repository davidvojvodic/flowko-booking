import { isENVDev } from "@calcom/lib/env";
import { IdentityProvider, UserPermissionRole } from "@calcom/prisma/enums";
import type { GetTokenParams } from "next-auth/jwt";
import { getToken } from "next-auth/jwt";

export type InstanceAdminCandidate = {
  role?: UserPermissionRole | "INACTIVE_ADMIN" | string | null;
  twoFactorEnabled?: boolean | null;
  identityProvider?: IdentityProvider | string | null;
};

/**
 * Flowko: an ADMIN counts as an instance admin only when their account meets the admin security
 * requirements, the same ones `validateRole` in next-auth-options.ts applies at sign-in. That check only
 * turns the JWT role into "INACTIVE_ADMIN"; the server reads the role from the database, where it is
 * still ADMIN. So every server-side instance-admin decision asks this helper instead of comparing roles.
 *
 * Mirrors validateRole on the user row:
 * - the role must be ADMIN
 * - a user whose identity provider is not CAL (Google, SAML) is exempt, as at sign-in
 * - an E2E or development environment is exempt, as at sign-in
 * - otherwise two-factor authentication must be on
 *
 * validateRole also requires a strong password, which cannot be read from the user row (only a hash is
 * stored). Its verdict lives only in the session's JWT role; pass that role as `signInRole` wherever a
 * session is at hand (isActiveInstanceAdminSession does), and an admin who signed in as INACTIVE_ADMIN
 * stays refused. Without `signInRole` (an API key has no session) only the row is checked.
 *
 * Fails closed: a missing field counts as 2FA off and identity provider CAL.
 */
export function isActiveInstanceAdmin(
  user: InstanceAdminCandidate | null | undefined,
  signInRole?: InstanceAdminCandidate["role"]
): boolean {
  if (!user || user.role !== UserPermissionRole.ADMIN) return false;
  if (signInRole !== undefined && signInRole !== UserPermissionRole.ADMIN) return false;
  if (user.identityProvider && user.identityProvider !== IdentityProvider.CAL) return true;
  if (process.env.NEXT_PUBLIC_IS_E2E) return true;
  if (user.twoFactorEnabled === true) return true;
  return isENVDev;
}

/**
 * Flowko: the role next-auth gave this session at sign-in, from its JWT. getServerSession replaces it with
 * the database role, so this is the only place where "INACTIVE_ADMIN" is still visible on the server.
 * Null when there is no request or no token.
 */
export async function getSignInRole(req: GetTokenParams["req"] | undefined) {
  if (!req) return null;
  const token = await getToken({ req });
  return token?.role ?? null;
}

/**
 * Flowko: isActiveInstanceAdmin for a signed-in request: the user row (with twoFactorEnabled and
 * identityProvider selected) and the session's sign-in role must both pass. Fails closed without a request.
 */
export async function isActiveInstanceAdminSession(
  user: InstanceAdminCandidate | null | undefined,
  req: GetTokenParams["req"] | undefined
): Promise<boolean> {
  // Only an admin by the row needs the JWT read at all
  if (!isActiveInstanceAdmin(user)) return false;
  return isActiveInstanceAdmin(user, await getSignInRole(req));
}
