// Flowko U29b (Task 7, S10, D4): Urnik's grid from md up: workers x the seven days (or, in „Običajni teden“, the
// seven weekdays). The desk's scroll container (`isolate`, so the sticky header z-40/z-50 stays below the shell's
// fixed bottom navigation), a sticky header row and a sticky name column, columns `minmax(5.5rem, 1fr)` with a
// horizontal scroll when narrower. Rows: the layout's visible members; a worker's own row is marked `data-own`.
import type { Weekday } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";

import { RosterCell, type RosterCellModel } from "./RosterCell";
import { RosterDayHeading } from "./RosterDayHeading";
import { WEEKDAY_TEXT_KEYS, type RosterLayout, cellDayText } from "./rosterModel";

export function RosterGrid(props: {
  layout: RosterLayout;
  onOpenDay: (date: string) => void;
  onSelect?: (cell: RosterCellModel) => void;
}) {
  const { t, i18n } = useLocale();
  const { layout } = props;
  const language = i18n?.language ?? "sl";
  // Flowko U29c (P6): the name track is a CSS variable (7rem, 10rem from xl) so the breakpoint lives in the class.
  const template = `var(--roster-name) repeat(${layout.keys.length}, minmax(5.5rem, 1fr))`;
  return (
    <div
      data-testid="roster-grid"
      // Flowko U29b (S10): 15rem keeps the toggle row in view, 17rem leaves room for the save bar while dirty.
      className={classNames(
        "border-subtle bg-default isolate overflow-auto rounded-md border",
        layout.dirty ? "max-h-[calc(100dvh-17rem)]" : "max-h-[calc(100dvh-15rem)]"
      )}>
      <div
        className="grid min-w-full [--roster-name:7rem] xl:[--roster-name:10rem]"
        style={{ gridTemplateColumns: template }}>
        <div
          data-testid="roster-grid-corner"
          className="bg-default border-subtle sticky left-0 top-0 z-50 border-b"
        />
        {layout.keys.map((key) => (
          <div
            key={key}
            data-testid={`roster-col-${key}`}
            className={classNames(
              "border-subtle sticky top-0 z-40 min-w-0 border-b border-l px-2 py-2",
              layout.isClosed(key) ? "bg-muted" : "bg-default"
            )}>
            {layout.mode === "usual" ? (
              <span
                data-testid={`roster-weekday-${key}`}
                className="text-emphasis text-sm font-semibold capitalize">
                {t(WEEKDAY_TEXT_KEYS[key as Weekday])}
              </span>
            ) : (
              <RosterDayHeading layout={layout} date={key} onOpenDay={props.onOpenDay} variant="grid" />
            )}
          </div>
        ))}
        {layout.members.map((member) => {
          const own = member.memberId === layout.ownId;
          return (
            <div
              key={member.memberId}
              data-testid={`roster-row-${member.memberId}`}
              data-own={own ? "true" : undefined}
              className="contents">
              <div
                data-testid={`roster-name-${member.memberId}`}
                className={classNames(
                  "border-subtle sticky left-0 z-40 flex items-center border-b px-2 py-1.5 text-sm font-medium",
                  own ? "bg-subtle text-emphasis font-semibold" : "bg-default text-default"
                )}>
                {/* Flowko U29c (P6): two lines, then the clamp; the title carries the full name. */}
                <span className="line-clamp-2 break-words" title={member.displayName}>
                  {member.displayName}
                </span>
              </div>
              {layout.keys.map((key) => (
                <RosterCell
                  key={key}
                  model={layout.cellOf(member.memberId, key)}
                  closed={layout.isClosed(key)}
                  onSelect={props.onSelect}
                  label={`${member.displayName}, ${cellDayText({ mode: layout.mode, key, t, language })}`}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
