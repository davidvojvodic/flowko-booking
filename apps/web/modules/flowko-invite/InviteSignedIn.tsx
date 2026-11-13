"use client";

// Flowko U29d (A6): a signed-in visitor (e.g. the owner opening the link on the salon device) is never switched to
// another account: no form, no salon name, no e-mail, the same view whatever the token; only a way to sign out.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";

import AuthContainer from "@components/ui/AuthContainer";

export function InviteSignedIn() {
  const { t } = useLocale();
  return (
    <AuthContainer showLogo heading={t("flowko_invite_accept_signed_in_title")}>
      <div className="stack-y-6" data-testid="flowko-invite-signed-in">
        <p className="text-default text-sm">{t("flowko_invite_accept_signed_in_body")}</p>
        <Button href="/auth/logout" color="primary" className="w-full justify-center">
          {t("sign_out")}
        </Button>
      </div>
    </AuthContainer>
  );
}
