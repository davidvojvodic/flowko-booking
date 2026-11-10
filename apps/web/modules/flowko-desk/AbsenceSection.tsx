// Flowko U29b (Task 9, S7, D12): the absence section of the Urnik cell sheet (week mode only; the sheet's `children`).
// Add: the absence starts on the cell's date, the last day defaults to the same date and can be changed; the
// server counts the holding bookings inside it: `needs_confirm` → a dialog with the plural count, „Vseeno dodaj“
// resends with confirm true, „Prekliči“ saves nothing. Remove: an absence the cell shows is listed with its stored
// range and removed whole. No reason (sick leave is health data). Absences are saved at once, not through the draft:
// both actions are off, with a hint, while the week has unsaved edits (the refresh would drop them). After a save
// the roster and the desk are refreshed, then the sheet closes (`onDone`). Errors are toasts (rosterErrors).
// Flowko U29c (P1, P8, R11): a saved add or removal shows „Shranjeno“; the refresh's answer goes to `onRefreshed`
// (false raises RosterView's notice, true clears it); the sheet closes anyway: the save stands.
import { useRef, useState } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { ConfirmationContent, Dialog, DialogContent } from "@calcom/ui/components/dialog";
import { TextField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";

import { formatDayLabel } from "./WeekGrid";
import { rosterErrorCode, rosterErrorKey } from "./rosterErrors";
import { useInvalidateRoster } from "./useRosterData";

export function AbsenceSection(props: {
  memberId: number;
  /** The cell's date: where a new absence starts. */
  date: string;
  /** Today in the business time zone (an absence that ended before it cannot be removed). */
  today: string;
  /** The member's stored absences of the shown week. */
  absences: Array<{ id: number; startDate: string; endDate: string }>;
  /** The draft holds unsaved edits. */
  dirty: boolean;
  /** An absence was saved or removed and the roster is refreshed: the caller closes the sheet. */
  onDone: () => void;
  /** Flowko U29c (P1, R11): a save stood; ok = roster.week was read again (false: the caller shows its notice). */
  onRefreshed: (ok: boolean) => void;
}) {
  const { t, i18n } = useLocale();
  const language = i18n?.language ?? "sl";
  const addAbsence = trpc.viewer.flowko.roster.addAbsence.useMutation();
  const removeAbsence = trpc.viewer.flowko.roster.removeAbsence.useMutation();
  const invalidate = useInvalidateRoster();
  const [endDate, setEndDate] = useState(props.date);
  const [bookings, setBookings] = useState<number | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // Only the resend (not the first add that opened the dialog) puts the dialog in its pending state: a disabled
  // „Prekliči“ cannot take the focus the dialog opens with (final review UI-3).
  const [resending, setResending] = useState(false);

  const covering = props.absences.filter((a) => a.startDate <= props.date && props.date <= a.endDate);
  const day = (date: string) => formatDayLabel(date, language);
  const rangeText = (a: { startDate: string; endDate: string }) =>
    a.startDate === a.endDate
      ? t("flowko_roster_absence_day", { date: day(a.startDate) })
      : t("flowko_roster_absence_range", { from: day(a.startDate), to: day(a.endDate) });

  /** Runs one write: a rejection is a toast and a fresh read; a result is handed to `onResult`. */
  async function run<T>(write: () => Promise<T>, onResult: (result: T) => Promise<boolean> | boolean) {
    if (busy || props.dirty) return;
    setBusy(true);
    try {
      const result = await write();
      if (await onResult(result)) {
        // The save stands even when the refresh fails. Flowko U29c (P1, P8): „Shranjeno“, and a failed refresh is
        // RosterView's notice (the stale versions hold „Shrani“ back there).
        const refreshed = await invalidate();
        showToast(t("saved"), "success");
        props.onRefreshed(refreshed);
        props.onDone();
      }
    } catch (error) {
      showToast(t(rosterErrorKey(rosterErrorCode(error))), "error");
      // Flowko U29c (P1): nothing was saved; the read again needs no answer (useInvalidateRoster never rejects).
      await invalidate();
    } finally {
      setBusy(false);
    }
  }

  const add = (confirm: boolean) =>
    run(
      () => addAbsence.mutateAsync({ memberId: props.memberId, startDate: props.date, endDate, confirm }),
      (result) => {
        if (result.status === "needs_confirm") {
          setBookings(result.bookings);
          return false;
        }
        return true;
      }
    );

  const remove = (absenceId: number) =>
    run(
      () => removeAbsence.mutateAsync({ absenceId }),
      () => true
    );

  const canAdd = endDate !== "" && endDate >= props.date && !props.dirty && !busy;

  return (
    <section data-testid="roster-absence" className="border-subtle flex flex-col gap-3 border-t pt-4">
      <h3 className="text-emphasis text-sm font-medium">{t("flowko_roster_absence_title")}</h3>
      {covering.map((absence) => (
        <div
          key={absence.id}
          data-testid={`roster-absence-${absence.id}`}
          className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-default text-sm">{rangeText(absence)}</span>
          {absence.endDate >= props.today && (
            <Button
              type="button"
              color="secondary"
              size="sm"
              disabled={props.dirty || busy}
              onClick={() => void remove(absence.id)}>
              {t("flowko_roster_absence_remove")}
            </Button>
          )}
        </div>
      ))}
      {covering.length === 0 && (
        <div className="flex flex-col gap-3">
          <TextField
            name="roster-absence-end"
            type="date"
            label={t("flowko_roster_absence_end")}
            value={endDate}
            min={props.date}
            disabled={props.dirty || busy}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <Button
            type="button"
            color="secondary"
            className="self-start"
            disabled={!canAdd}
            loading={busy}
            onClick={() => void add(false)}>
            {t("flowko_roster_absence_add")}
          </Button>
        </div>
      )}
      {props.dirty && <p className="text-subtle text-xs">{t("flowko_roster_absence_dirty_hint")}</p>}
      <Dialog open={bookings !== null} onOpenChange={(open) => !open && setBookings(null)}>
        <DialogContent
          type="creation"
          ref={confirmRef}
          // Flowko U29b final review (UI-3): open on „Prekliči“, not „Vseeno dodaj“ (the UnsavedChangesDialog pattern).
          onOpenAutoFocus={(event) => {
            const stay = confirmRef.current?.querySelector<HTMLElement>('[data-testid="dialog-rejection"]');
            if (!stay) return;
            event.preventDefault();
            stay.focus();
          }}>
          <ConfirmationContent
            variety="warning"
            title={t("flowko_roster_absence_confirm_title")}
            confirmBtnText={t("flowko_roster_absence_confirm_add")}
            cancelBtnText={t("cancel")}
            isPending={busy && resending}
            onConfirm={() => {
              setResending(true);
              void add(true).finally(() => setResending(false));
            }}>
            <p>{t("flowko_roster_absence_bookings", { count: bookings ?? 0 })}</p>
            <p className="mt-1">{t("flowko_roster_warnings_unchanged")}</p>
          </ConfirmationContent>
        </DialogContent>
      </Dialog>
    </section>
  );
}
