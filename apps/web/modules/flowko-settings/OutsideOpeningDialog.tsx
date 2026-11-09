// Flowko U29a: the narrower-opening dialog (S3). The save answered needs_confirm with two counts: shift days and
// bookings the new opening (or the holiday switch) would newly leave outside. One plural line per non-zero count;
// nothing is moved or cancelled. „Vseeno shrani“ lets the caller resend with confirm: true; „Prekliči“ closes and
// keeps the caller's form as it is.
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ConfirmationDialogContent, Dialog } from "@calcom/ui/components/dialog";

export type OutsideCounts = { shifts: number; bookings: number };

export function OutsideOpeningDialog(props: {
  open: boolean;
  outside: OutsideCounts;
  /** A resend is running: „Vseeno shrani“ is off. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { shifts, bookings } = props.outside;
  const lines: string[] = [];
  if (shifts > 0) lines.push(t("flowko_settings_outside_shifts", { count: shifts }));
  if (bookings > 0) lines.push(t("flowko_settings_outside_bookings", { count: bookings }));
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <ConfirmationDialogContent
        variety="warning"
        title={t("flowko_settings_outside_title")}
        confirmBtnText={t("flowko_settings_outside_save")}
        cancelBtnText={t("cancel")}
        isPending={props.busy}
        onConfirm={props.onConfirm}>
        <p className="mt-2">{t("flowko_settings_outside_body")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {lines.map((line) => (
            <li key={line} data-testid="flowko-settings-outside-line">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-2">{t("flowko_settings_outside_unchanged")}</p>
      </ConfirmationDialogContent>
    </Dialog>
  );
}
