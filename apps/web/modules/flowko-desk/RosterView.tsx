// Flowko U29b (Task 7, S1, S8, S9, S10, S11, D4, D5, D13, D14): Urnik's read view, the third desk view. DeskView owns
// the state (S13): the roster answer (`view`, `isPending`), the mode, the date and the business `today` (S1), the
// draft (keyed by week + mode) and the leave `guard`. This component only draws: the „Ta teden“ / „Običajni teden“
// toggle (the owner only), the grid from md up or the phone's one-day card list, from the draft's snapshot while edits
// are open. `onOpenDay` (a day header's date → Dan) and `onModeChange` already run through DeskView's guard; they are
// not wrapped again here (a second guard would ask twice). A phone day arrow inside the week is DeskView's, unguarded.
// Editing (cell sheet, save bar, warnings) is Task 8, absences Task 9.
import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ToggleGroup } from "@calcom/ui/components/form";
import { useFlowkoBusiness } from "@calcom/web/lib/flowko/useFlowkoBusiness";

import { RosterDayList } from "./RosterDayList";
import { RosterGrid } from "./RosterGrid";
import { buildRosterLayout } from "./rosterModel";
import type { useRosterDraft } from "./useRosterDraft";

export type { RosterCellModel } from "./RosterCell";

export function RosterView(props: {
  view: RosterWeekView | undefined;
  isPending: boolean;
  mode: "week" | "usual";
  date: string;
  today: string;
  isPhone: boolean;
  draft: ReturnType<typeof useRosterDraft>;
  guard: (action: () => void) => void;
  onOpenDay: (date: string) => void;
  onModeChange: (mode: "week" | "usual") => void;
}) {
  const { t } = useLocale();
  const business = useFlowkoBusiness();
  const { view, draft } = props;

  if (!view) {
    return (
      <div data-testid="roster-view">
        <p className="text-subtle py-12 text-center text-sm">{t("loading")}</p>
      </div>
    );
  }

  // S9: a WORKER's own row is pinned first; the owner's and STAFF's rows stay in position order.
  const me = business.status === "member" ? business.me : null;
  const layout = buildRosterLayout({
    // S13: while edits are open the view is the snapshot they started from (the poll is paused anyway).
    view: draft.snapshot ?? view,
    mode: props.mode,
    draft,
    today: props.today,
    ownId: me?.role === "WORKER" ? me.memberId : null,
  });

  return (
    <div data-testid="roster-view" className="flex flex-col gap-3">
      {view.canEditUsualWeek && (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={props.mode}
            onValueChange={(next) => {
              if (next !== props.mode) props.onModeChange(next as "week" | "usual");
            }}
            options={[
              { value: "week", label: t("flowko_roster_mode_week"), dataTestId: "roster-mode-week" },
              { value: "usual", label: t("flowko_roster_mode_usual"), dataTestId: "roster-mode-usual" },
            ]}
          />
        </div>
      )}
      {layout.members.length === 0 ? (
        <p className="text-subtle py-12 text-center text-sm">{t("flowko_desk_no_columns")}</p>
      ) : props.isPhone ? (
        <RosterDayList layout={layout} date={props.date} onOpenDay={props.onOpenDay} />
      ) : (
        <RosterGrid layout={layout} onOpenDay={props.onOpenDay} />
      )}
    </div>
  );
}
