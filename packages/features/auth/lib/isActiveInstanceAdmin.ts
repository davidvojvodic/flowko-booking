import { isENVDev } from "@calcom/lib/env";
import { IdentityProvider, UserPermissionRole } from "@calcom/prisma/enums";

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
 * session is at hand, and an admin who signed in as INACTIVE_ADMIN stays refused.
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
