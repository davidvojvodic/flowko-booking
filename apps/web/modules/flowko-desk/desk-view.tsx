// Flowko U28: the desk (/koledar), client-only (desk-view-client.tsx). Day view: one column per worker, the date
// in the URL (?date=, default today in the business time zone from the server's clock), polling every 30 s
// (R13), the „who are you“ chip (R9), and on a phone one column at a time with a worker select (R15). Taps open
// the booking sheet (empty spot) or the details sheet (a booking); in move mode (R12) a tap moves the booking
// instead, and the mode survives a date change because its state lives here. From md up the week view (D2,
// ?view=week&worker=) shows one worker x seven days; a phone always gets the day view.
// Flowko U29a (S7): the chip only when the owner's „shared device“ switch is on (business.me.sharedDevice); off, the
// signed-in member acts and no role sees a chip. Rights (canBook) stay with the role.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";
import { todayIn } from "@calcom/lib/flowkoBusiness/roster";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import useMediaQuery from "@calcom/lib/hooks/useMediaQuery";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { useFlowkoBusiness } from "@calcom/web/lib/flowko/useFlowkoBusiness";

import { ActorChip } from "./ActorChip";
import { BookingDetailsSheet } from "./BookingDetailsSheet";
import { BookingSheet } from "./BookingSheet";
import { ConfirmProblemsDialog } from "./ConfirmProblemsDialog";
import { DateBar, useDeskParams } from "./DateBar";
import { DayGrid } from "./DayGrid";
import type { DeskContextValue } from "./DeskContext";
import { DeskContext } from "./DeskContext";
import { WeekGrid, mondayOf } from "./WeekGrid";
import type { DeskBookTarget } from "./WorkerColumn";
import { WorkerPicker } from "./WorkerPicker";
import { useDeskActor } from "./useDeskActor";
import { useDeskDay, useDeskMembers, useDeskWeek } from "./useDeskData";
import { useDeskWrites } from "./useDeskWrites";
import { useMoveMode } from "./useMoveMode";

/** Below Tailwind's md (768 px). */
const PHONE_QUERY = "(max-width: 767px)";

export default function DeskView() {
  const { t } = useLocale();
  const business = useFlowkoBusiness();
  const utils = trpc.useUtils();
  const params = useDeskParams();
  const isPhone = useMediaQuery(PHONE_QUERY);

  // Until the server has answered, today is the browser's; then the business's (server clock, R18).
  const [today, setToday] = useState(() =>
    todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date())
  );
  const date = params.state.date ?? today;
  // Flowko U28 (D2): the week view from md up; weekStart = the Monday of the business-zone date (not the browser's
  // or the profile's week start). The worker: ?worker= if it has a column, else the user's own, else the first.
  const weekMode = params.state.view === "week" && !isPhone;
  const members = useDeskMembers();
  const workers = useMemo(() => (members.data ?? []).filter((m) => m.hasColumn), [members.data]);
  const meId = business.status === "member" ? business.me.memberId : null;
  const weekWorker =
    (
      workers.find((w) => w.memberId === params.state.worker) ??
      workers.find((w) => w.memberId === meId) ??
      workers[0]
    )?.memberId ?? null;
  const dayQuery = useDeskDay(date, { enabled: !weekMode });
  const weekQuery = useDeskWeek(mondayOf(date), weekWorker, { enabled: weekMode });
  const day = weekMode ? weekQuery : dayQuery;
  const view = day.view;

  useEffect(() => {
    if (!view) return;
    const businessToday = todayIn(view.timeZone, new Date(view.now));
    if (businessToday !== today) setToday(businessToday);
  }, [view, today]);

  const me = business.status === "member" ? business.me : null;
  const session = useMemo(
    () =>
      me
        ? { businessId: me.businessId, memberId: me.memberId, role: me.role, sharedDevice: me.sharedDevice }
        : null,
    [me]
  );
  const actor = useDeskActor(session, members.data);

  const [bookTarget, setBookTarget] = useState<DeskBookTarget | null>(null);
  const [detailsBookingId, setDetailsBookingId] = useState<number | null>(null);
  const [reenterFrom, setReenterFrom] = useState<DeskBooking | null>(null);

  const writes = useDeskWrites({ actor, refetch: day.refetch, invalidate: day.invalidate });
  const closeDetails = useCallback(() => setDetailsBookingId(null), []);
  const moveMode = useMoveMode(writes, { onMoved: closeDetails });
  const moving = moveMode.moving;
  const onBook = (target: DeskBookTarget) => (moving ? moveMode.tap(target) : setBookTarget(target));
  // Flowko U28 (R5): a WORKER (fixed actor) books and moves only in her own column; the server refuses the rest.
  const canBook = (column: { isMe: boolean }) => !actor.fixed || column.isMe;
  const onOpenDetails = (bookingId: number) => {
    if (!moving) setDetailsBookingId(bookingId);
  };
  const detailsBooking =
    detailsBookingId === null
      ? undefined
      : view?.days.flatMap((d) => d.bookings).find((b) => b.bookingId === detailsBookingId);

  const columns = view?.days[0]?.columns ?? [];
  // Flowko U28c (M3): the moving booking's worker, by name (never declined), for the banner. An empty name falls
  // through to the next source; with none at all the banner names the customer instead (review).
  const movingWorkerName = moving
    ? (members.data ?? []).find((m) => m.memberId === moving.memberId)?.displayName ||
      columns.find((c) => c.memberId === moving.memberId)?.displayName ||
      ""
    : "";
  const openDay = (d: string) => {
    params.setView("day");
    params.setDate(d === today ? null : d);
  };
  // Flowko U28 (R12, R15): on a phone in move mode the one column shown is the moving booking's worker.
  const phoneMemberId = isPhone
    ? (moving?.memberId ??
      (columns.find((c) => c.memberId === params.state.worker) ?? columns.find((c) => c.isMe) ?? columns[0])
        ?.memberId ??
      null)
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
    moveMode,
    reenterFrom,
    setReenterFrom,
  };

  // Flowko U28: the layout lets only members in, so „no business“ here is a failed or stale answer: no grid that
  // cannot write (no actor), the load error with a retry of business.me instead.
  if (business.status === "none") {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-default text-sm">{t("flowko_desk_load_error")}</p>
        <Button color="secondary" onClick={() => void utils.viewer.flowko.business.me.refetch()}>
          {t("try_again")}
        </Button>
      </div>
    );
  }

  return (
    <DeskContext.Provider value={context}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DateBar
            date={date}
            today={today}
            view={weekMode ? "week" : "day"}
            weekAvailable={!isPhone}
            onDateChange={params.setDate}
            onViewChange={(next) => {
              // Flowko U28 (R12): „move me to Thursday“: the week opens on the moving booking's worker.
              if (next === "week" && moving) params.setWorker(moving.memberId);
              params.setView(next);
            }}
          />
          {me?.sharedDevice === true && <ActorChip actor={actor} />}
        </div>
        {weekMode && workers.length > 0 && (
          <WorkerPicker workers={workers} value={weekWorker} onChange={params.setWorker} />
        )}
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
        {moving && (
          // Flowko U28c (M3): a clearer banner right on top of the grid, naming the worker whose column to tap.
          <div
            data-testid="desk-move-banner"
            role="status"
            className="bg-semantic-info-subtle text-emphasis border-semantic-info flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-base font-semibold">
            <span>
              {movingWorkerName
                ? t("flowko_desk_move_banner_column", { name: movingWorkerName })
                : t("flowko_desk_move_banner", { name: moving.customer.name })}
            </span>
            <Button color="secondary" onClick={moveMode.stop}>
              {t("cancel")}
            </Button>
          </div>
        )}
        {view && weekMode && (
          <WeekGrid
            view={view}
            receivedAt={day.receivedAt}
            onBook={onBook}
            canBook={canBook}
            onOpenDetails={onOpenDetails}
            onOpenDay={openDay}
            movingMemberId={moving?.memberId ?? null}
          />
        )}
        {view && !weekMode && (
          <DayGrid
            view={view}
            date={date}
            receivedAt={day.receivedAt}
            onlyMemberId={phoneMemberId}
            onBook={onBook}
            canBook={canBook}
            onOpenDetails={onOpenDetails}
            movingMemberId={moving?.memberId ?? null}
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
        {!view && !day.error && weekMode && members.data && weekWorker === null && (
          <p className="text-subtle py-12 text-center text-sm">{t("flowko_desk_no_columns")}</p>
        )}
        {!view && !day.error && !(weekMode && members.data && weekWorker === null) && (
          <p className="text-subtle py-12 text-center text-sm">{t("loading")}</p>
        )}
      </div>
      {view && bookTarget && (
        <BookingSheet
          key={`${bookTarget.memberId}-${bookTarget.start}`}
          target={{ kind: "create", memberId: bookTarget.memberId, start: bookTarget.start }}
          onClose={() => setBookTarget(null)}
        />
      )}
      {view && reenterFrom && (
        <BookingSheet
          key={`reenter-${reenterFrom.bookingId}`}
          target={{ kind: "reenter", booking: reenterFrom }}
          onClose={() => setReenterFrom(null)}
        />
      )}
      {detailsBooking && (
        <BookingDetailsSheet key={detailsBooking.bookingId} booking={detailsBooking} onClose={closeDetails} />
      )}
      {view && (
        <ConfirmProblemsDialog
          open={moveMode.confirm !== null}
          problems={moveMode.confirm?.problems ?? []}
          googleUnavailable={moveMode.confirm?.googleUnavailable ?? false}
          stepNames={moveMode.confirm?.booking.steps?.map((s) => s.serviceName) ?? []}
          fallbackName={moveMode.confirm?.booking.serviceNames.join(", ")}
          timeZone={view.timeZone}
          onConfirm={() => void moveMode.confirmOverride()}
          onClose={moveMode.dismissConfirm}
        />
      )}
    </DeskContext.Provider>
  );
}
