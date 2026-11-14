// Flowko U29c: „Dodaj brez prijave“ (W4, C15): a desk-only worker is added by name. The name is checked here (1 to
// 80 characters after trimming; the server checks again and answers bad_member for the same reason); the server
// refuses a name another member already has (case-insensitive) with member_name_taken. Both errors stay inline
// under the field (aria-invalid + accessible description), the typed value is kept, and typing clears the error.
// The caller does the write and answers what happened.
// Flowko U29e: the name is checked with the server's rule (memberNameProblem, RIGHTS-1): a control, bidi or
// invisible character shows its own text before any call. A standing hint under the title says what the person gets:
// no login and an own column, plus the owner's usual week when the list says the owner has one (E5, R4).
"use client";

import { memberNameProblem, MEMBER_NAME_MAX } from "@calcom/lib/flowkoBusiness/memberName";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { TextField } from "@calcom/ui/components/form";
import { useId, useState } from "react";

export type AddWorkerResult = "ok" | "bad_name" | "member_name_taken" | "failed";

export function AddDeskWorkerForm(props: {
  /** A write or refresh elsewhere on the page is running. */
  disabled: boolean;
  /** Flowko U29e (E5): the owner has a usual week, so a new worker gets it (workers.list `ownerUsualWeek`). */
  ownerUsualWeek: boolean;
  onAdd: (displayName: string) => Promise<AddWorkerResult>;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [error, setError] = useState<"bad_name" | "name_characters" | "member_name_taken" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorId = `${useId()}-name-error`;

  async function submit() {
    const problem = memberNameProblem(name);
    if (problem) {
      setError(problem === "characters" ? "name_characters" : "bad_name");
      return;
    }
    setSubmitting(true);
    try {
      const result = await props.onAdd(name.trim());
      if (result === "ok") {
        setName("");
        setError(null);
      } else if (result === "bad_name" || result === "member_name_taken") {
        setError(result);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errorText = error ? t(`flowko_workers_error_${error}`) : undefined;

  return (
    <form
      noValidate
      data-testid="flowko-worker-add-form"
      className="border-subtle mt-8 border-t pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
      <h2 className="text-emphasis text-base font-semibold">{t("flowko_workers_add_title")}</h2>
      <p className="text-subtle mt-1 text-sm">
        <span>{t("flowko_workers_add_hint")}</span>
        {props.ownerUsualWeek && <span> {t("flowko_workers_add_hint_week")}</span>}
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <div className="min-w-[14rem] flex-1">
          <TextField
            name="flowko-worker-name"
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
            <p
              id={errorId}
              role="alert"
              data-testid="flowko-worker-name-error"
              className="text-error mt-1 text-sm">
              {errorText}
            </p>
          )}
        </div>
        <Button type="submit" color="primary" className="mt-6" loading={submitting} disabled={props.disabled}>
          {t("flowko_workers_add_button")}
        </Button>
      </div>
    </form>
  );
}
