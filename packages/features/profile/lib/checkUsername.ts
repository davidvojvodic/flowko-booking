import {
  isReservedUsername,
  RESERVED_USERNAME_MESSAGE,
} from "@calcom/features/auth/signup/utils/reservedUsernames";
import { IS_PREMIUM_USERNAME_ENABLED } from "@calcom/lib/constants";
import { usernameCheck as checkPremiumUsername } from "@calcom/lib/server/username";
import slugify from "@calcom/lib/slugify";

import { checkRegularUsername } from "./checkRegularUsername";

// TODO: Replace `lib/checkPremiumUsername` with `usernameCheck` and then import checkPremiumUsername directly here.
// We want to remove dependency on website for signup stuff as signup is now part of app.
const checkUsernameAvailability = !IS_PREMIUM_USERNAME_ENABLED ? checkRegularUsername : checkPremiumUsername;

/**
 * Flowko (U13 hardening): a reserved name (a top-level route, a locale, or a name ending in "embed"; see
 * reservedUsernames.ts) is never available. This is the check behind the username field's availability
 * hint (`/api/username`) and behind `viewer.me.updateProfile` (profile settings and onboarding), which
 * refuses an unavailable username with `username_already_taken`.
 */
export const checkUsername = async (username: string, currentOrgDomain?: string | null) => {
  if (isReservedUsername(slugify(username))) {
    return { available: false as const, premium: false, message: RESERVED_USERNAME_MESSAGE };
  }
  return checkUsernameAvailability(username, currentOrgDomain);
};
