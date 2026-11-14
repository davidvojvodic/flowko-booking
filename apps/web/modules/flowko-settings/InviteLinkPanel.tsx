// Flowko U29d: the one-time invite link (U3, C3). Shown after a create, a resend or a new link; one at a time (a new
// one replaces it). Title „Povabilo: <ime>“, the lines the caller passes (mail sent / not sent / new link ready),
// the link in a read-only field the owner can select by hand (not `disabled`: Cal's TextField turns readOnly into
// disabled, which a phone cannot select), „Kopiraj povezavo“ (a fresh click writes the clipboard; a refusal says so
// and selects the field), the once-only line, the C10 hint (brand-new WORKER: the owner's usual week; desk-only
// worker: everything stays; STAFF: none) and „Zapri“. The link lives only in the caller's state: closing the panel
// or leaving the page drops it, it is never logged and never auto-copied. The title takes the focus on open and is
// described by the lines, so a screen reader hears „not sent, copy the link“ too (U29d UI-5).
// Flowko U29e (E5, R4): a brand-new WORKER's hint names the owner's usual week only when the list said the owner has
// one ("new_worker"); otherwise "new_worker_no_week" says the shifts are set in Urnik. The shared RAW replaces the
// inline opt-out (E10.1).
"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { Input, Label } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";
import { useEffect, useId, useRef } from "react";
import { copyText } from "./copyText";

export type InvitePanelLine = { text: string; tone: "info" | "warning" };

export type InvitePanelData = {
  /** The invite whose link this is (revoking it closes the panel). */
  inviteId: number;
  name: string;
  link: string;
  lines: InvitePanelLine[];
  hint: InviteHint | null;
};

/** Flowko U29e (E5): "new_worker_no_week" = a brand-new WORKER while the owner has no usual week to copy. */
export type InviteHint = "new_worker" | "new_worker_no_week" | "desk_worker";

const HINT_KEYS: Record<InviteHint, string> = {
  new_worker: "flowko_invite_hint_new_worker",
  new_worker_no_week: "flowko_invite_hint_new_worker_no_week",
  desk_worker: "flowko_invite_hint_desk_worker",
};

export function InviteLinkPanel(props: { panel: InvitePanelData; onClose: () => void }) {
  const { t } = useLocale();
  const titleId = useId();
  const fieldId = useId();
  const linesId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const { panel } = props;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function copy() {
    if (await copyText(panel.link)) {
      showToast(t("flowko_invite_copied"), "success");
      return;
    }
    showToast(t("flowko_invite_copy_failed"), "error");
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }

  return (
    <section
      data-testid="flowko-invite-panel"
      aria-labelledby={titleId}
      className="border-subtle mt-8 rounded-md border p-4">
      <h2
        id={titleId}
        ref={titleRef}
        tabIndex={-1}
        // UI-5: the title takes the focus, so it carries the lines (mail sent / not sent) as its description.
        aria-describedby={linesId}
        className="text-emphasis break-words text-base font-semibold focus:outline-none">
        {t("flowko_invite_panel_title", { name: panel.name, ...RAW })}
      </h2>
      <div id={linesId} className="mt-3 flex flex-col gap-2">
        {panel.lines.map((line) =>
          line.tone === "warning" ? (
            <Alert key={line.text} severity="warning" title={line.text} />
          ) : (
            <p key={line.text} className="text-default break-words text-sm">
              {line.text}
            </p>
          )
        )}
      </div>
      <div className="mt-4">
        <Label htmlFor={fieldId}>{t("flowko_invite_link_label")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={fieldId}
            ref={fieldRef}
            readOnly
            value={panel.link}
            autoComplete="off"
            spellCheck={false}
            className="min-w-[14rem] flex-1"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" color="primary" StartIcon="copy" onClick={() => void copy()}>
            {t("flowko_invite_copy")}
          </Button>
        </div>
      </div>
      <p className="text-subtle mt-3 text-sm">{t("flowko_invite_link_once")}</p>
      {panel.hint && <p className="text-subtle mt-2 text-sm">{t(HINT_KEYS[panel.hint])}</p>}
      <div className="mt-4">
        <Button type="button" color="secondary" onClick={props.onClose}>
          {t("close")}
        </Button>
      </div>
    </section>
  );
}
