// Flowko U29b (Ruling R2): Urnik's view, a shell with the final props until Task 7 builds the grid, the phone list
// and the mode toggle. DeskView owns the state (S13): the roster answer (`view`, `isPending`), the mode, the date and
// the business `today` (S1), the draft (keyed by week + mode) and the leave `guard`; `onOpenDay` (Dan for a date)
// and `onModeChange` already run through the guard.
import type { RosterWeekView } from "@calcom/features/flowkoBusiness/roster";

import type { useRosterDraft } from "./useRosterDraft";

export function RosterView(_props: {
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
  return <div data-testid="roster-view" />;
}
