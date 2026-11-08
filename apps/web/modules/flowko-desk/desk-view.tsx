// Flowko U28: the desk (/koledar), client-only (desk-view-client.tsx). Day view: one column per worker, the date
// in the URL (?date=, default today in the business time zone from the server's clock), polling every 30 s
// (R13), the „who are you“ chip (R9), and on a phone one column at a time with a worker select (R15). Taps set
// the booking/details targets in DeskContext; the sheets that open from them come with Task 7.
"use client";

import { useEffect, useMemo, useState } from "react";

import { todayIn } from "@calcom/lib/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import useMediaQuery from "@calcom/lib/hooks/useMediaQuery";
import { Button } from "@calcom/ui/components/button";
import { useFlowkoBusiness } from "@calcom/web/lib/flowko/useFlowkoBusiness";

import { ActorChip } from "./ActorChip";
import { DateBar, useDeskParams } from "./DateBar";
import { DayGrid } from "./DayGrid";
import type { DeskContextValue } from "./DeskContext";
import { DeskContext } from "./DeskContext";
import type { DeskBookTarget } from "./WorkerColumn";
import { useDeskActor } from "./useDeskActor";
import { useDeskDay, useDeskMembers } from "./useDeskData";

/** Below Tailwind's md (768 px). */
const PHONE_QUERY = "(max-width: 767px)";

export default function DeskView() {
  const { t } = useLocale();
  const business = useFlowkoBusiness();
  const params = useDeskParams();
  const isPhone = useMediaQuery(PHONE_QUERY);

  // Until the server has answered, today is the browser's; then the business's (server clock, R18).
  const [today, setToday] = useState(() =>
    todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date())
  );
  const date = params.state.date ?? today;
  const day = useDeskDay(date);
  const members = useDeskMembers();
  const view = day.view;

  useEffect(() => {
    if (!view) return;
    const businessToday = todayIn(view.timeZone, new Date(view.now));
    if (businessToday !== today) setToday(businessToday);
  }, [view, today]);

  const me = business.status === "member" ? business.me : null;
  const session = useMemo(
    () => (me ? { businessId: me.businessId, memberId: me.memberId, role: me.role } : null),
    [me]
  );
  const actor = useDeskActor(session, members.data);

  const [bookTarget, setBookTarget] = useState<DeskBookTarget | null>(null);
  const [detailsBookingId, setDetailsBookingId] = useState<number | null>(null);

  const columns = view?.days[0]?.columns ?? [];
  const phoneMemberId = isPhone
    ? (columns.find((c) => c.memberId === params.state.worker) ??
        columns.find((c) => c.isMe) ??
        columns[0])?.memberId ?? null
    : null;

  const context: DeskContextValue = {
    date,
    view,
    actor,
    refetch: day.refetch,
    invalidate: day.invalidate,
    bookTarget,
    setBookTarget,
    detailsBookingId,
    setDetailsBookingId,
  };

  return (
    <DeskContext.Provider value={context}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DateBar
            date={date}
            today={today}
            // Flowko U28: the week view comes with Task 8; until then the desk shows the day.
            view="day"
            onDateChange={params.setDate}
            onViewChange={params.setView}
          />
          <ActorChip actor={actor} />
        </div>
        {isPhone && columns.length > 0 && (
          <label className="text-default flex items-center gap-2 text-sm">
            <span>{t("flowko_desk_worker")}</span>
            <select
              className="border-default bg-default text-emphasis h-9 flex-1 rounded-md border px-2 text-sm"
              value={phoneMemberId ?? ""}
              onChange={(e) => params.setWorker(Number(e.target.value))}>
              {columns.map((c) => (
                <option key={c.memberId} value={c.memberId}>
                  {c.locked ? t("flowko_desk_locked_column", { name: c.displayName }) : c.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {view && (
          <DayGrid
            view={view}
            date={date}
            receivedAt={day.receivedAt}
            onlyMemberId={phoneMemberId}
            onBook={setBookTarget}
            onOpenDetails={setDetailsBookingId}
          />
        )}
        {!view && day.error && (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-default text-sm">{t("flowko_desk_load_error")}</p>
            <Button color="secondary" onClick={() => void day.refetch()}>
              {t("try_again")}
            </Button>
          </div>
        )}
        {!view && !day.error && <p className="text-subtle py-12 text-center text-sm">{t("loading")}</p>}
      </div>
    </DeskContext.Provider>
  );
}
