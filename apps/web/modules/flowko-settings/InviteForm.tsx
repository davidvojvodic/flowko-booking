// Flowko U29d: „Povabi s prijavo“ (U2, C2–C6): the owner invites a brand-new person by name, e-mail and role
// (Delavec = WORKER, own column; Recepcija = STAFF, no column; Delavec by default). Checked here first: the name
// is 1 to 80 characters after trimming; the e-mail passes inviteEmailSchema (trimmed, lower-cased, an e-mail shape,
// never a placeholder or desk address), the same schema the server uses. The server's answers that belong to a
// field stay inline under it (aria-invalid + accessible description, typed values kept, typing clears the error):
// bad_member / member_name_taken on the name; invite_bad_email / email_has_login / invite_pending on the e-mail.
// The caller does the write (and shows the link panel) and answers what happened; the form clears on "ok".
"use client";

import type { InviteRole } from "@calcom/lib/flowkoBusiness/invites";
import { inviteEmailSchema } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { TextField } from "@calcom/ui/components/form";
import { RadioField, RadioGroup } from "@calcom/ui/components/radio";
import { useId, useState } from "react";

export type InviteNameError = "bad_name" | "member_name_taken";
export type InviteEmailError = "invite_bad_email" | "email_has_login" | "invite_pending";
export type InviteFormResult = "ok" | InviteNameError | InviteEmailError | "failed";

const MAX_NAME = 80;

export const inviteEmailErrorKey = (error: InviteEmailError) => `flowko_invite_error_${error}`;

export function InviteForm(props: {
  /** A write or refresh elsewhere on the page is running. */
  disabled: boolean;
  onInvite: (input: { name: string; email: string; role: InviteRole }) => Promise<InviteFormResult>;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("WORKER");
  const [nameError, setNameError] = useState<InviteNameError | null>(null);
  const [emailError, setEmailError] = useState<InviteEmailError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const id = useId();
  const nameErrorId = `${id}-name-error`;
  const emailErrorId = `${id}-email-error`;
  const roleLabelId = `${id}-role`;

  async function submit() {
    const trimmed = name.trim();
    const badName = trimmed.length < 1 || trimmed.length > MAX_NAME;
    const parsed = inviteEmailSchema.safeParse(email);
    setNameError(badName ? "bad_name" : null);
    setEmailError(parsed.success ? null : "invite_bad_email");
    if (badName || !parsed.success) return;
    setSubmitting(true);
    try {
      const result = await props.onInvite({ name: trimmed, email: parsed.data, role });
      if (result === "ok") {
        setName("");
        setEmail("");
        setRole("WORKER");
      } else if (result === "bad_name" || result === "member_name_taken") {
        setNameError(result);
      } else if (result !== "failed") {
        setEmailError(result);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const nameText = nameError ? t(`flowko_workers_error_${nameError}`) : undefined;
  const emailText = emailError ? t(inviteEmailErrorKey(emailError)) : undefined;

  return (
    <form
      noValidate
      data-testid="flowko-invite-form"
      className="border-subtle mt-8 border-t pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
      <h2 className="text-emphasis text-base font-semibold">{t("flowko_invite_form_title")}</h2>
      <p className="text-subtle mt-1 text-sm">{t("flowko_invite_form_hint")}</p>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <div className="min-w-[14rem] flex-1">
          <TextField
            name="flowko-invite-name"
            label={t("flowko_workers_add_name")}
            maxLength={MAX_NAME}
            value={name}
            aria-invalid={nameText ? true : undefined}
            aria-describedby={nameText ? nameErrorId : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          {nameText && (
            <p
              id={nameErrorId}
              role="alert"
              data-testid="flowko-invite-name-error"
              className="text-error mt-1 text-sm">
              {nameText}
            </p>
          )}
        </div>
        <div className="min-w-[14rem] flex-1">
          <TextField
            name="flowko-invite-email"
            type="email"
            autoComplete="off"
            label={t("email")}
            maxLength={320}
            value={email}
            aria-invalid={emailText ? true : undefined}
            aria-describedby={emailText ? emailErrorId : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />
          {emailText && (
            <p
              id={emailErrorId}
              role="alert"
              data-testid="flowko-invite-email-error"
              className="text-error mt-1 text-sm">
              {emailText}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4">
        <p id={roleLabelId} className="text-emphasis mb-2 text-sm font-medium">
          {t("flowko_invite_form_role")}
        </p>
        <RadioGroup
          value={role}
          aria-labelledby={roleLabelId}
          onValueChange={(value) => setRole(value === "STAFF" ? "STAFF" : "WORKER")}
          className="flex flex-col gap-2">
          <RadioField
            id={`${id}-role-worker`}
            value="WORKER"
            label={
              <>
                <span>{t("flowko_desk_worker")}</span>
                <span className="text-subtle block font-normal">{t("flowko_invite_role_worker_hint")}</span>
              </>
            }
          />
          <RadioField
            id={`${id}-role-staff`}
            value="STAFF"
            label={
              <>
                <span>{t("flowko_workers_role_staff")}</span>
                <span className="text-subtle block font-normal">{t("flowko_invite_role_staff_hint")}</span>
              </>
            }
          />
        </RadioGroup>
      </div>
      <Button type="submit" color="primary" className="mt-4" loading={submitting} disabled={props.disabled}>
        {t("flowko_invite_send")}
      </Button>
    </form>
  );
}
