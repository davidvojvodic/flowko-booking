// Flowko U29b (Task 8, S13, S14, D7): the Urnik save bar „N sprememb · Shrani · Zavrzi“. On a phone it floats above
// the shell's bottom navigation (`fixed inset-x-2 bottom-20 z-40`, the Shell CTA's PWA offset); from md up it sticks to
// the bottom of the page. It is rendered by RosterView outside the grid's scroll container (that one is `isolate`, so
// a z-40 inside it would stay under the navigation). „Zavrzi“ asks once, with „Prekliči“ focused (the D1 b pattern:
// ConfirmationContent puts the confirm button first in the DOM). In „Običajni teden“ the bar always says that weeks
// with their own roster stay unchanged (`usualNote`, D9).
import { useRef, useState } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { ConfirmationContent, Dialog, DialogContent } from "@calcom/ui/components/dialog";

export function RosterSaveBar(props: {
  count: number;
  /** A save is running (through the refresh that follows it): „Shrani“ and „Zavrzi“ are off. */
  busy: boolean;
  usualNote: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useLocale();
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        data-testid="roster-save-bar"
        className="border-subtle bg-default shadow-dropdown pwa:bottom-[max(7rem,_calc(5rem_+_env(safe-area-inset-bottom)))] fixed inset-x-2 bottom-20 z-40 flex flex-col gap-1 rounded-md border px-3 py-2 md:sticky md:inset-x-auto md:bottom-0 md:z-30">
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="roster-save-count" className="text-emphasis mr-auto text-sm font-semibold">
            {t("flowko_roster_changes", { count: props.count })}
          </span>
          <Button
            type="button"
            color="secondary"
            size="sm"
            disabled={props.busy}
            onClick={() => setAsking(true)}>
            {t("flowko_roster_discard")}
          </Button>
          <Button
            type="button"
            color="primary"
            size="sm"
            loading={props.busy}
            disabled={props.busy}
            onClick={props.onSave}>
            {t("save")}
          </Button>
        </div>
        {props.usualNote && (
          <p data-testid="roster-save-note" className="text-subtle text-xs">
            {t("flowko_roster_usual_note")}
          </p>
        )}
      </div>
      {asking && (
        <Dialog open onOpenChange={(open) => !open && setAsking(false)}>
          <DialogContent
            type="creation"
            ref={askRef}
            onOpenAutoFocus={(event) => {
              const stay = askRef.current?.querySelector<HTMLElement>('[data-testid="dialog-rejection"]');
              if (!stay) return;
              event.preventDefault();
              stay.focus();
            }}>
            <ConfirmationContent
              variety="warning"
              title={t("flowko_roster_discard_title")}
              confirmBtnText={t("flowko_roster_discard")}
              cancelBtnText={t("cancel")}
              onConfirm={() => {
                setAsking(false);
                props.onDiscard();
              }}>
              <p className="mt-2">{t("flowko_roster_unsaved_body")}</p>
            </ConfirmationContent>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
