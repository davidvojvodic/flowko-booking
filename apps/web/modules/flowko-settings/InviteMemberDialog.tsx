// Flowko U29d: „Povabi“ on a desk-only worker's row (D1, C9): one e-mail field (focused on open). The person keeps
// their column, schedule, bookings and services; on accept the same member and user become the login. The address
// is checked here first (inviteEmailSchema, as the server); invite_bad_email, email_has_login and invite_pending
// stay inline under the field with the typed value kept. The caller does the write, closes the dialog on success
// (and shows the link panel) or on an answer that makes the invite impossible, and toasts anything else.
// The name stands alone or as the subject, never declined.
// Flowko U29e (E10.1): the shared RAW replaces the inline opt-out.
"use client";

import type { WorkerListRow } from "@calcom/lib/flowkoBusiness/workers";
import { inviteEmailSchema } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@calcom/ui/components/dialog";
import { TextField } from "@calcom/ui/components/form";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";
import { useId, useRef, useState } from "react";
import { type InviteEmailError, inviteEmailErrorKey } from "./InviteForm";

export type InviteMemberResult = "ok" | InviteEmailError | "failed";

export function InviteMemberDialog(props: {
  row: WorkerListRow;
  /** A write or refresh elsewhere on the page is running. */
  disabled: boolean;
  onInvite: (email: string) => Promise<InviteMemberResult>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<InviteEmailError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const errorId = `${useId()}-email-error`;
  const name = props.row.displayName;

  async function submit() {
    const parsed = inviteEmailSchema.safeParse(email);
    if (!parsed.success) {
      setError("invite_bad_email");
      return;
    }
    setSubmitting(true);
    try {
      const result = await props.onInvite(parsed.data);
      if (result !== "ok" && result !== "failed") setError(result);
    } finally {
      setSubmitting(false);
    }
  }

  const errorText = error ? t(inviteEmailErrorKey(error)) : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        type="creation"
        data-testid="flowko-invite-member-dialog"
        title={t("flowko_invite_dialog_title", { name, ...RAW })}
        description={t("flowko_invite_dialog_body", { name, ...RAW })}
        onOpenAutoFocus={(event) => {
          if (!fieldRef.current) return;
          event.preventDefault();
          fieldRef.current.focus();
        }}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}>
          <TextField
            ref={fieldRef}
            name="flowko-invite-member-email"
            type="email"
            autoComplete="off"
            label={t("email")}
            maxLength={320}
            value={email}
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? errorId : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
          {errorText && (
            <p id={errorId} role="alert" className="text-error mt-1 text-sm">
              {errorText}
            </p>
          )}
          <DialogFooter noSticky>
            <DialogClose>{t("cancel")}</DialogClose>
            <Button type="submit" color="primary" loading={submitting} disabled={props.disabled}>
              {t("flowko_invite_send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
