// Flowko U29c: „Zakleni“ confirm (W7, C11). Opens on „Prekliči“ (ConfirmationContent puts the confirm button first
// in the DOM, so the focus is set explicitly, the UnsavedChangesDialog pattern). The text says how many future
// bookings the worker keeps (the FRESH count the caller passes: they stay until the owner cancels them) and, for a
// person with a login (WORKER or STAFF), that sign-in will be blocked and Google disconnected. The name stands
// alone or as the subject, never declined.
// Flowko U29e (E10.1): the name is printed once (RAW).
"use client";

import type { WorkerListRow } from "@calcom/lib/flowkoBusiness/workers";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ConfirmationContent, Dialog, DialogContent } from "@calcom/ui/components/dialog";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";
import { useRef } from "react";

export function LockWorkerDialog(props: { row: WorkerListRow; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const { row } = props;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        type="creation"
        ref={ref}
        data-testid="flowko-worker-lock-dialog"
        onOpenAutoFocus={(event) => {
          const cancel = ref.current?.querySelector<HTMLElement>('[data-testid="dialog-rejection"]');
          if (!cancel) return;
          event.preventDefault();
          cancel.focus();
        }}>
        <ConfirmationContent
          variety="warning"
          title={t("flowko_workers_lock_title", { name: row.displayName, ...RAW })}
          confirmBtnText={t("flowko_workers_lock")}
          cancelBtnText={t("cancel")}
          onConfirm={props.onConfirm}>
          <div className="mt-2 flex flex-col gap-2">
            <p>
              {row.futureCount > 0
                ? t("flowko_workers_lock_bookings", { name: row.displayName, count: row.futureCount, ...RAW })
                : t("flowko_workers_lock_no_bookings", { name: row.displayName, ...RAW })}
            </p>
            {!row.noLogin && <p>{t("flowko_workers_lock_login")}</p>}
          </div>
        </ConfirmationContent>
      </DialogContent>
    </Dialog>
  );
}
