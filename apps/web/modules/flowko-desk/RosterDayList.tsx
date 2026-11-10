// Flowko U29b (Task 7, S1, S10, D4): Urnik on a phone: one day, all workers, one card per worker (a worker's own
// card first and marked). „Ta teden“: the day is the one DeskView's date points to (its day arrows step by one day
// and keep the draft inside the week); the heading is the same date button + holiday label as the grid's. „Običajni
// teden“: no dates; its own weekday arrows Monday…Sunday (local state, starts at the weekday of `date`, no wrap, never
// touches the URL, nothing to guard).
import { useState } from "react";

import { weekdayOf } from "@calcom/lib/flowkoBusiness/roster";
import { WEEKDAYS } from "@calcom/lib/flowkoBusiness/schemas";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import classNames from "@calcom/ui/classNames";
import { Button } from "@calcom/ui/components/button";

import { RosterCell, type RosterCellModel } from "./RosterCell";
import { RosterDayHeading } from "./RosterDayHeading";
import { WEEKDAY_TEXT_KEYS, type RosterLayout } from "./rosterModel";

export function RosterDayList(props: {
  layout: RosterLayout;
  /** The date DeskView shows (week mode: which day; usual mode: the weekday to start on). */
  date: string;
  onOpenDay: (date: string) => void;
  onSelect?: (cell: RosterCellModel) => void;
}) {
  const { t } = useLocale();
  const { layout } = props;
  const [weekdayIndex, setWeekdayIndex] = useState(() => WEEKDAYS.indexOf(weekdayOf(props.date)));
  const usual = layout.mode === "usual";
  const key = usual ? WEEKDAYS[weekdayIndex] : (layout.keys.find((k) => k === props.date) ?? layout.keys[0]);

  return (
    <div data-testid="roster-day-list" className="flex flex-col gap-2">
      <div className="border-subtle bg-default flex items-center gap-2 rounded-md border px-3 py-2">
        {usual ? (
          <>
            <Button
              variant="icon"
              color="secondary"
              StartIcon="chevron-left"
              aria-label={t("flowko_roster_prev_weekday")}
              disabled={weekdayIndex === 0}
              onClick={() => setWeekdayIndex((i) => Math.max(0, i - 1))}
            />
            <span
              data-testid="roster-weekday-label"
              className="text-emphasis flex-1 text-center text-sm font-semibold capitalize">
              {t(WEEKDAY_TEXT_KEYS[WEEKDAYS[weekdayIndex]])}
            </span>
            <Button
              variant="icon"
              color="secondary"
              StartIcon="chevron-right"
              aria-label={t("flowko_roster_next_weekday")}
              disabled={weekdayIndex === WEEKDAYS.length - 1}
              onClick={() => setWeekdayIndex((i) => Math.min(WEEKDAYS.length - 1, i + 1))}
            />
          </>
        ) : (
          key && <RosterDayHeading layout={layout} date={key} onOpenDay={props.onOpenDay} />
        )}
      </div>
      {key &&
        layout.members.map((member) => {
          const own = member.memberId === layout.ownId;
          return (
            <div
              key={member.memberId}
              data-testid={`roster-card-${member.memberId}`}
              data-own={own ? "true" : undefined}
              className={classNames(
                "border-subtle overflow-hidden rounded-md border",
                own ? "bg-subtle" : "bg-default"
              )}>
              <p
                className={classNames(
                  "text-emphasis px-3 pt-2 text-sm",
                  own ? "font-semibold" : "font-medium"
                )}>
                {member.displayName}
              </p>
              <RosterCell
                model={layout.cellOf(member.memberId, key)}
                closed={layout.isClosed(key)}
                onSelect={props.onSelect}
              />
            </div>
          );
        })}
    </div>
  );
}
