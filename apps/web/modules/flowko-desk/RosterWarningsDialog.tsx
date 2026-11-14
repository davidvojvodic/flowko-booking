// Flowko U29b (Task 8, S14, D10): the one combined warnings dialog a save answers with (`needs_confirm`): per worker,
// in row order, the days (dates, or weekdays in „Običajni teden“) with shifts outside the opening hours and the
// number of bookings that end up outside the shifts. Nothing moves by itself („Termini se ne premaknejo.“); the usual
// week's dialog also says that weeks with their own roster stay unchanged. „Vseeno shrani“ lets the caller resend
// with confirm: true; „Prekliči“ closes and keeps the draft. Person names are shown as they are, never declined.
// Flowko U29e (E10.1): the days pass RAW (an en date „Mon, 11/23“ would show „&#x2F;“).
import { useRef } from "react";

import type { RosterWarning } from "@calcom/lib/flowkoBusiness/roster";
import type { Weekday } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ConfirmationContent, Dialog, DialogContent } from "@calcom/ui/components/dialog";
import { RAW } from "@calcom/web/lib/flowko/i18nRaw";

import { formatDayLabel } from "./WeekGrid";
import { WEEKDAY_TEXT_KEYS } from "./rosterModel";
import type { RosterMode } from "./useRosterDraft";

export function RosterWarningsDialog(props: {
  open: boolean;
  mode: RosterMode;
  warnings: RosterWarning[];
  /** The rows of the save in their order (names for the groups, and the order the groups follow). */
  members: Array<{ memberId: number; displayName: string }>;
  /** The resend is running: „Vseeno shrani“ is off. */
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const language = i18n?.language ?? "sl";
  const groups = props.members.flatMap((member) => {
    const warning = props.warnings.find((w) => w.memberId === member.memberId);
    return warning ? [{ member, warning }] : [];
  });
  const dayText = (key: string) =>
    props.mode === "usual" ? t(WEEKDAY_TEXT_KEYS[key as Weekday]) : formatDayLabel(key, language);
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        type="creation"
        ref={ref}
        // Flowko U29b final review (UI-3): open on „Prekliči“ (ConfirmationContent puts the confirm button first in the
        // DOM, so Radix would focus „Vseeno shrani“); the UnsavedChangesDialog pattern.
        onOpenAutoFocus={(event) => {
          const stay = ref.current?.querySelector<HTMLElement>('[data-testid="dialog-rejection"]');
          if (!stay) return;
          event.preventDefault();
          stay.focus();
        }}>
        <ConfirmationContent
          variety="warning"
          title={t("flowko_roster_warnings_title")}
          confirmBtnText={t("flowko_roster_warnings_save")}
          cancelBtnText={t("cancel")}
          isPending={props.busy}
          onConfirm={props.onConfirm}>
          <div className="mt-2 flex flex-col gap-3">
            {groups.map(({ member, warning }) => (
              <div key={member.memberId} data-testid={`roster-warning-group-${member.memberId}`}>
                <p className="text-emphasis font-medium">{member.displayName}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {warning.outsideOpening.length > 0 && (
                    <li>
                      {t("flowko_roster_warning_outside", {
                        days: warning.outsideOpening.map(dayText).join(", "),
                        ...RAW,
                      })}
                    </li>
                  )}
                  {warning.bookingsNewlyOutside > 0 && (
                    <li>{t("flowko_roster_warning_bookings", { count: warning.bookingsNewlyOutside })}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3">{t("flowko_roster_warnings_unchanged")}</p>
          {props.mode === "usual" && (
            <p data-testid="roster-warning-usual-note" className="mt-1">
              {t("flowko_roster_usual_note")}
            </p>
          )}
        </ConfirmationContent>
      </DialogContent>
    </Dialog>
  );
}
