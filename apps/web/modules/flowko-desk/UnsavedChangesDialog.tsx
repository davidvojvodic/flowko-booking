// Flowko U29b (S13): „Neshranjene spremembe“: Urnik's leave/switch confirm. Opens on „Ostani“ (the safe choice;
// ConfirmationContent puts the confirm button first in the DOM, so the focus is set explicitly, the D1 b pattern);
// „Zavrzi in nadaljuj“ discards the draft and runs what the user asked for (the caller's onDiscard).
import { useRef } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ConfirmationContent, Dialog, DialogContent } from "@calcom/ui/components/dialog";

export function UnsavedChangesDialog(props: { open: boolean; onStay: () => void; onDiscard: () => void }) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onStay()}>
      <DialogContent
        type="creation"
        ref={ref}
        data-testid="roster-unsaved-dialog"
        onOpenAutoFocus={(event) => {
          const stay = ref.current?.querySelector<HTMLElement>('[data-testid="dialog-rejection"]');
          if (!stay) return;
          event.preventDefault();
          stay.focus();
        }}>
        <ConfirmationContent
          variety="warning"
          title={t("flowko_roster_unsaved_title")}
          confirmBtnText={t("flowko_roster_unsaved_discard")}
          cancelBtnText={t("flowko_roster_unsaved_stay")}
          onConfirm={props.onDiscard}>
          <p className="mt-2">{t("flowko_roster_unsaved_body")}</p>
        </ConfirmationContent>
      </DialogContent>
    </Dialog>
  );
}
