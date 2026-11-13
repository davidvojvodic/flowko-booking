"use client";

// Flowko U29d (A1): the one view for every invite link that cannot be accepted (malformed, unknown, used, revoked,
// expired, rotated, an ineligible desk-only member, business gone). It names nobody (no salon, no e-mail, no
// person) and looks the same whatever the cause, so the page is no oracle. The accept form switches to it when the
// POST answers invite_invalid. InviteTooMany is the page's answer when its per-IP limit is hit (independent of the
// token, so it says nothing about the link either).
import { useLocale } from "@calcom/lib/hooks/useLocale";

import AuthContainer from "@components/ui/AuthContainer";

export function InviteInvalid() {
  const { t } = useLocale();
  return (
    <AuthContainer showLogo heading={t("flowko_invite_accept_invalid_title")}>
      <p className="text-default text-sm" data-testid="flowko-invite-invalid">
        {t("flowko_invite_accept_invalid_body")}
      </p>
    </AuthContainer>
  );
}

export function InviteTooMany() {
  const { t } = useLocale();
  return (
    <AuthContainer showLogo heading={t("flowko_invite_accept_meta_title")}>
      <p className="text-default text-sm" role="alert" data-testid="flowko-invite-too-many">
        {t("flowko_settings_error_TOO_MANY_REQUESTS")}
      </p>
    </AuthContainer>
  );
}
