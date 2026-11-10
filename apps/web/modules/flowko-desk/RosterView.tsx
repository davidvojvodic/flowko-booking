// Flowko U29b (Task 7, S1, S8, S9, S10, S11, D4, D5, D13, D14; Task 8, S12–S16, D6–D11): Urnik, the third desk view.
// DeskView owns the state (S13): the roster answer (`view`, `isPending`), the mode, the date and the business `today`
// (S1), the draft (keyed by week + mode) and the leave `guard`. This component draws the „Ta teden“ / „Običajni teden“
// toggle (the owner only), „Kopiraj prejšnji teden“, the grid from md up or the phone's one-day card list (from the
// draft's snapshot while edits are open), and carries the editing: a tapped cell opens the cell sheet, „Uporabi“
// writes the draft, the save bar saves it (S14: needs_confirm → warnings → resend with confirm; roster_changed →
// draft dropped, week refetched, alert; other codes → toasts; saved → await the refresh, then drop the draft).
// `onOpenDay` (a day header's date → Dan) and `onModeChange` already run through DeskView's guard; they are not
// wrapped again here (a second guard would ask twice). A phone day arrow inside the week is DeskView's, unguarded.
// Absences (Task 9, S7) are the cell sheet's `children`: AbsenceSection, saved at once, off while the draft is dirty.
// Flowko U29c (P1, P8): every save (week/usual saved, absence add/remove, holiday open/close) shows „Shranjeno“; the
// refresh after it is checked (useInvalidateRoster answers whether roster.week was read again). A failed one raises
// the notice here („Poskusi znova“ runs the refresh again); „Shrani“ waits while it is up (the versions are stale).
// Flowko U29c (Ruling R8): while the notice is up no new edit starts either (cell taps, so also absences, and
// „Kopiraj prejšnji teden“ are off): an edit would start from the stale answer. Flowko U29c (Ruling R11): the notice
// also goes on any later successful read of roster.week (a later save's probe, the 30 s poll or a refetch:
// `receivedAt` advanced) and on another week or mode.
import { useRef, useState } from "react";

import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";
import { type RosterWarning, addDays, weekdayOf } from "@calcom/lib/flowkoBusiness/roster";
import type { Weekday } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import classNames from "@calcom/ui/classNames";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { ToggleGroup } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { useFlowkoBusiness } from "@calcom/web/lib/flowko/useFlowkoBusiness";

import { AbsenceSection } from "./AbsenceSection";
import { RosterCellSheet } from "./RosterCellSheet";
import { RosterDayList } from "./RosterDayList";
import { RosterGrid } from "./RosterGrid";
import { RosterSaveBar } from "./RosterSaveBar";
import { RosterWarningsDialog } from "./RosterWarningsDialog";
// Flowko U29c (R11): the week the refresh-failed notice belongs to.
import { mondayOf } from "./WeekGrid";
import { buildRosterLayout, cellDayText } from "./rosterModel";
import { rosterErrorCode, rosterErrorKey } from "./rosterErrors";
import { storedCell, type useRosterDraft } from "./useRosterDraft";
import { useInvalidateRoster } from "./useRosterData";

export type { RosterCellModel } from "./RosterCell";

export function RosterView(props: {
  view: RosterWeekView | undefined;
  isPending: boolean;
  /** Flowko U29c (R11): when the shown roster.week answer arrived (the query's dataUpdatedAt; 0 = none yet). */
  receivedAt: number;
  mode: "week" | "usual";
  date: string;
  today: string;
  isPhone: boolean;
  draft: ReturnType<typeof useRosterDraft>;
  guard: (action: () => void) => void;
  onOpenDay: (date: string) => void;
  onModeChange: (mode: "week" | "usual") => void;
}) {
  const { t, i18n } = useLocale();
  const language = i18n?.language ?? "sl";
  const business = useFlowkoBusiness();
  const utils = trpc.useUtils();
  const invalidate = useInvalidateRoster();
  const saveWeek = trpc.viewer.flowko.roster.saveWeek.useMutation();
  const saveUsualWeeks = trpc.viewer.flowko.roster.saveUsualWeeks.useMutation();
  const { view, draft, mode } = props;

  const [selected, setSelected] = useState<{ memberId: number; key: string } | null>(null);
  const [warnings, setWarnings] = useState<RosterWarning[] | null>(null);
  // A save or a copy is running: cells are not tappable, „Shrani“ is busy (S14).
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  // The week + mode the „changed meanwhile“ alert belongs to (S14); a new edit or another week hides it.
  const [staleScope, setStaleScope] = useState<string | null>(null);

  // Flowko U29b (Task 8 fix 1, D7): the week + mode shown now, for a save or copy that finishes after the user moved on.
  const scopeRef = useRef("");
  // Flowko U29c (P1): a save stood but roster.week could not be read again; „Poskusi znova“ is running.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Flowko U29c (R11): every checked refresh reports its answer; a working one clears the notice again.
  const onRefreshed = (ok: boolean) => setRefreshFailed(!ok);
  // Flowko U29c (R11): a newer roster.week answer (poll, refetch, another save's refresh) or another week or mode
  // clears the notice (React's „state from props“ pattern, as useRosterDraft). A failed refetch never moves
  // dataUpdatedAt, so it never clears it.
  const noticeKey = `${mondayOf(props.date)}|${props.mode}`;
  const [seen, setSeen] = useState({ key: noticeKey, receivedAt: props.receivedAt });
  if (seen.key !== noticeKey || seen.receivedAt !== props.receivedAt) {
    if (seen.key !== noticeKey || props.receivedAt > seen.receivedAt) setRefreshFailed(false);
    setSeen({ key: noticeKey, receivedAt: props.receivedAt });
  }
  async function retryRefresh() {
    setRetrying(true);
    try {
      setRefreshFailed(!(await invalidate()));
    } finally {
      setRetrying(false);
    }
  }

  if (!view) {
    return (
      <div data-testid="roster-view">
        <p className="text-subtle py-12 text-center text-sm">{t("loading")}</p>
      </div>
    );
  }

  // S13: while edits are open the view is the snapshot they started from (the poll is paused anyway).
  const shown = draft.snapshot ?? view;
  const scope = `${shown.weekStart}|${mode}`;
  scopeRef.current = scope;
  // A save or a copy is running: no new edit starts, and „Shrani“ waits (S14).
  const locked = saving || copying;
  // Flowko U29c (R8): no new edit (cell tap, copy) while a save runs or the refresh-failed notice is up.
  const editable = !locked && !refreshFailed;
  // S9: a WORKER's own row is pinned first; the owner's and STAFF's rows stay in position order.
  const me = business.status === "member" ? business.me : null;
  const layout = buildRosterLayout({
    view: shown,
    mode,
    draft,
    today: props.today,
    ownId: me?.role === "WORKER" ? me.memberId : null,
    // Flowko U29c (P1, R11): the holiday menu in the day headers reports its refresh answer here.
    onRefreshed,
  });

  // S15: the rows „Kopiraj prejšnji teden“ fills: editable, visible; none on a read-only week or in the usual week.
  const copyTargets = layout.members.filter((m) => shown.editableMemberIds.includes(m.memberId));
  const canCopy =
    mode === "week" &&
    copyTargets.length > 0 &&
    shown.weekStart <= shown.lastWritableWeekStart &&
    shown.days.some((d) => d.date >= props.today);

  async function copyPrevious() {
    setCopying(true);
    try {
      const previous = await utils.viewer.flowko.roster.week.fetch({
        weekStart: addDays(shown.weekStart, -7),
      });
      draft.copyPreviousWeek(
        view as RosterWeekView,
        previous,
        copyTargets.map((m) => m.memberId)
      );
      setStaleScope(null);
    } catch (error) {
      showToast(t(rosterErrorKey(rosterErrorCode(error))), "error");
    } finally {
      setCopying(false);
    }
  }

  /** S14: one save (confirm = false) or its resend after the warnings (confirm = true). */
  async function send(confirm: boolean) {
    if (!draft.snapshot) return;
    const startedIn = scope;
    setSaving(true);
    try {
      const result =
        mode === "week"
          ? await saveWeek.mutateAsync({
              weekStart: draft.snapshot.weekStart,
              rows: draft.weekRows(),
              confirm,
            })
          : await saveUsualWeeks.mutateAsync({ rows: draft.usualRows(), confirm });
      if (result.status === "needs_confirm") {
        // The warnings are about the week the save started in; another week is showing now: drop them.
        if (scopeRef.current === startedIn) setWarnings(result.warnings);
        return;
      }
      setWarnings(null);
      // S16: the edit stays on screen until the fresh answer is in; a failed refresh does not undo the save.
      // Flowko U29c (P1, P8, R11): the refresh answers; the draft goes either way, „Shranjeno“, and the answer
      // raises (failed) or clears (worked) the notice.
      const refreshed = await invalidate();
      draft.discard();
      showToast(t("saved"), "success");
      setRefreshFailed(!refreshed);
    } catch (error) {
      setWarnings(null);
      const code = rosterErrorCode(error);
      if (code === "roster_changed") {
        // D8: nothing was saved; the draft goes, the current roster is read again and the alert says why.
        draft.discard();
        setStaleScope(scope);
        // Flowko U29c (P1): nothing was saved, so no notice; useInvalidateRoster never rejects.
        await invalidate();
      } else {
        showToast(t(rosterErrorKey(code)), "error");
      }
    } finally {
      setSaving(false);
    }
  }

  const sheetMember = selected ? shown.members.find((m) => m.memberId === selected.memberId) : undefined;
  const sheetDay = selected
    ? shown.days.find((d) =>
        mode === "usual" ? weekdayOf(d.date) === selected.key : d.date === selected.key
      )
    : undefined;

  return (
    <div
      data-testid="roster-view"
      // Flowko U29b (S13): room under the phone's floating save bar, so the last row stays reachable.
      className={classNames("flex flex-col gap-3", draft.dirty && "pb-28 md:pb-0")}>
      {(view.canEditUsualWeek || canCopy) && (
        <div className="flex flex-wrap items-center gap-2">
          {view.canEditUsualWeek && (
            <ToggleGroup
              value={mode}
              onValueChange={(next) => {
                if (next !== mode) props.onModeChange(next as "week" | "usual");
              }}
              options={[
                { value: "week", label: t("flowko_roster_mode_week"), dataTestId: "roster-mode-week" },
                { value: "usual", label: t("flowko_roster_mode_usual"), dataTestId: "roster-mode-usual" },
              ]}
            />
          )}
          {canCopy && (
            <Button
              type="button"
              color="secondary"
              size="sm"
              StartIcon="copy"
              data-testid="roster-copy-previous"
              loading={copying}
              // Flowko U29c (R8): also off while the refresh-failed notice is up.
              disabled={copying || saving || refreshFailed}
              onClick={() => void copyPrevious()}>
              {t("flowko_roster_copy_previous")}
            </Button>
          )}
        </div>
      )}
      {refreshFailed && (
        <div role="alert" data-testid="roster-refresh-failed">
          <Alert
            severity="warning"
            title={t("flowko_roster_refresh_failed")}
            actions={
              <Button
                type="button"
                color="secondary"
                size="sm"
                loading={retrying}
                onClick={() => void retryRefresh()}>
                {t("try_again")}
              </Button>
            }
          />
        </div>
      )}
      {staleScope === scope && !draft.dirty && (
        <div role="alert" data-testid="roster-stale">
          <Alert severity="warning" title={t("flowko_roster_stale")} />
        </div>
      )}
      {layout.members.length === 0 ? (
        <p className="text-subtle py-12 text-center text-sm">{t("flowko_desk_no_columns")}</p>
      ) : props.isPhone ? (
        <RosterDayList
          layout={layout}
          date={props.date}
          onOpenDay={props.onOpenDay}
          onSelect={editable ? (cell) => setSelected({ memberId: cell.memberId, key: cell.key }) : undefined}
        />
      ) : (
        <RosterGrid
          layout={layout}
          onOpenDay={props.onOpenDay}
          onSelect={editable ? (cell) => setSelected({ memberId: cell.memberId, key: cell.key }) : undefined}
        />
      )}
      {draft.dirty && (
        <RosterSaveBar
          count={draft.changedCount}
          busy={locked}
          // Flowko U29c (P1): the versions are stale until „Poskusi znova“ worked.
          saveBlocked={refreshFailed}
          usualNote={mode === "usual"}
          onSave={() => void send(false)}
          onDiscard={draft.discard}
        />
      )}
      {selected && sheetMember && (
        <RosterCellSheet
          key={`${selected.memberId}:${selected.key}`}
          title={`${sheetMember.displayName} · ${cellDayText({ mode, key: selected.key, t, language })}`}
          mode={mode}
          // The cell's value in snapshot + draft, or the live answer while the draft is clean (Task 6 note).
          value={
            draft.snapshot != null
              ? draft.cell(selected.memberId, selected.key)
              : storedCell(view, selected.memberId, selected.key, mode)
          }
          usualEntries={
            sheetMember.usualWeek?.[(mode === "usual" ? selected.key : weekdayOf(selected.key)) as Weekday] ??
            []
          }
          opening={sheetDay?.opening ?? []}
          closed={mode === "week" && layout.isClosed(selected.key)}
          onApply={(value) => {
            draft.set(view, selected.memberId, selected.key, value);
            setStaleScope(null);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}>
          {/* Flowko U29b (Task 9, S7): week mode only (the sheet renders its children there only). */}
          <AbsenceSection
            memberId={selected.memberId}
            date={selected.key}
            today={props.today}
            absences={sheetMember.absences}
            dirty={draft.dirty}
            onDone={() => setSelected(null)}
            onRefreshed={onRefreshed}
          />
        </RosterCellSheet>
      )}
      <RosterWarningsDialog
        open={warnings !== null}
        mode={mode}
        warnings={warnings ?? []}
        members={shown.members.map((m) => ({ memberId: m.memberId, displayName: m.displayName }))}
        busy={saving}
        onConfirm={() => void send(true)}
        onClose={() => setWarnings(null)}
      />
    </div>
  );
}
