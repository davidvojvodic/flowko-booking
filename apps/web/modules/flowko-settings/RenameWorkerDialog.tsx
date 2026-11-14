// Flowko U29e (E9, R6–R8): „Preimenuj“ on a „Delavci“ row. One name field, prefilled with the current name and
// focused on open; the hints say where the new name shows: always „from now on in the calendar, Urnik and
// Storitve“; for a desk-only worker also that customers see it in mails, bookings already made included (R7); for a
// person with a login that mails keep the name of their own account (R6); a STAFF member without a login gets no
// mail hint (no column, no mails). The name is checked here with the server's rule (memberNameProblem: 1 to 80
// characters after trimming, no control, bidi or invisible characters) before any call; an unchanged trimmed name
// closes the dialog without a call (a case-only change is a change). bad_member and member_name_taken stay inline
// under the field (aria-invalid + accessible description, the typed value kept, typing clears the error). The caller
// does the write, closes the dialog on success or when the list is stale, and toasts anything else. The name in the
// title stands alone, never declined.
"use client";

import { memberNameProblem, MEMBER_NAME_MAX } from "@calcom/lib/flowkoBusiness/memberName";
import type { WorkerListRow } from "@calcom/lib/flowkoBusiness/workers";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@calcom/ui/components/dialog";
import { TextField } from "@calcom/ui/components/form";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";
import { useId, useRef, useState } from "react";

export type RenameNameError = "bad_name" | "name_characters" | "member_name_taken";
export type RenameWorkerResult = "ok" | "bad_name" | "member_name_taken" | "failed";

/** Which mail hint a row gets: a desk-only worker's name reaches customers; a login keeps its own account name. */
function mailHintKey(row: WorkerListRow): string | null {
  if (!row.noLogin) return "flowko_workers_rename_hint_login";
  if (row.role !== "STAFF") return "flowko_workers_rename_hint_desk";
  return null;
}

export function RenameWorkerDialog(props: {
  row: WorkerListRow;
  /** A write or refresh elsewhere on the page is running. */
  disabled: boolean;
  onRename: (displayName: string) => Promise<RenameWorkerResult>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { row } = props;
  const [name, setName] = useState(row.displayName);
  const [error, setError] = useState<RenameNameError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const errorId = `${useId()}-name-error`;
  const mailHint = mailHintKey(row);

  async function submit() {
    const problem = memberNameProblem(name);
    if (problem) {
      setError(problem === "characters" ? "name_characters" : "bad_name");
      return;
    }
    const trimmed = name.trim();
    if (trimmed === row.displayName) {
      props.onClose();
      return;
    }
    setSubmitting(true);
    try {
      const result = await props.onRename(trimmed);
      if (result === "bad_name" || result === "member_name_taken") setError(result);
    } finally {
      setSubmitting(false);
    }
  }

  const errorText = error ? t(`flowko_workers_error_${error}`) : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        type="creation"
        data-testid="flowko-worker-rename-dialog"
        title={t("flowko_workers_rename_title", { name: row.displayName, ...RAW })}
        description={t("flowko_workers_rename_hint")}
        onOpenAutoFocus={(event) => {
          if (!fieldRef.current) return;
          event.preventDefault();
          fieldRef.current.focus();
          fieldRef.current.select();
        }}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}>
          {mailHint && <p className="text-subtle mb-3 text-sm">{t(mailHint)}</p>}
          <TextField
            ref={fieldRef}
            name="flowko-worker-rename"
            autoComplete="off"
            label={t("flowko_workers_add_name")}
            maxLength={MEMBER_NAME_MAX}
            value={name}
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? errorId : undefined}
            onChange={(e) => {
              setName(e.target.value);
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
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
