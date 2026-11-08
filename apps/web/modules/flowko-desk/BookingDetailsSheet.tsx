// Flowko U28: the booking details sheet. What the booking is (title, time, steps, customer), its history („who did
// what“, design §3, oldest first, overrides listed), and the actions its server flags allow (R5): „Prestavi“
// (tap mode, or the date + time field here, R12), „Prestavi k drugemu delavcu“ (re-enter, only `mayReenter`),
// no-show and its undo (D4), cancel with an optional reason. Every write goes through useDeskWrites (actor, R13).
// Flowko U28c (David, 2026-11-08): „Prestavi“ opens a move panel inside this sheet (date, the booking's worker's
// free starts, time, „Potrdi prestavitev“ through moveMode.moveTo); a link under it starts the calendar tap mode.
import { useEffect, useRef, useState } from "react";

import dayjs from "@calcom/dayjs";
import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";
import { formatHm } from "@calcom/lib/flowkoBusiness/desk";
import { localDateSchema, todayIn } from "@calcom/lib/flowkoBusiness/roster";
import type { Ms } from "@calcom/lib/flowkoSalon";
import { wallClockToMs } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import { ConfirmationDialogContent, Dialog } from "@calcom/ui/components/dialog";
import { Label, TextArea, TextField } from "@calcom/ui/components/form";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@calcom/ui/components/sheet";

import { ms } from "./BookingBlock";
import { useDeskContext } from "./DeskContext";
import { FreeStartChips } from "./FreeStartChips";
import { useDeskWrites } from "./useDeskWrites";

type T = (key: string, opts?: Record<string, unknown>) => string;
type Action = DeskBooking["actions"][number];

const when = (iso: string, timeZone: string) => dayjs(iso).tz(timeZone).format("D. M. YYYY HH:mm");
const dayOf = (iso: string, timeZone: string) => dayjs(iso).tz(timeZone).format("YYYY-MM-DD");

/** „iz 13:00 na 13:30“ on the same day, else with the day: „iz 17. 11. 08:30 na 16. 11. 09:00“. */
function fromTo(from: string, to: string, timeZone: string) {
  if (dayOf(from, timeZone) === dayOf(to, timeZone)) {
    return { from: formatHm(ms(from), timeZone), to: formatHm(ms(to), timeZone) };
  }
  const f = (iso: string) => dayjs(iso).tz(timeZone).format("D. M. HH:mm");
  return { from: f(from), to: f(to) };
}

function record(details: unknown): Record<string, unknown> {
  return typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
}

/** The history as lines, oldest first; actions the desk has no line for are left out. */
export function historyLines(actions: Action[], timeZone: string, t: T): string[] {
  const lines: string[] = [];
  for (const a of actions) {
    const d = record(a.details);
    const base = { name: a.actorName ?? t("flowko_desk_history_unknown_actor"), time: when(a.at, timeZone) };
    if (a.kind === "CREATED") lines.push(t("flowko_desk_history_created", base));
    else if (a.kind === "RESCHEDULED" && typeof d.fromStart === "string" && typeof d.toStart === "string")
      lines.push(
        t("flowko_desk_history_rescheduled", { ...base, ...fromTo(d.fromStart, d.toStart, timeZone) })
      );
    else if (a.kind === "NO_SHOW")
      lines.push(
        t(d.noShow === false ? "flowko_desk_history_no_show_undone" : "flowko_desk_history_no_show", base)
      );
    else if (a.kind === "CANCELLED") lines.push(t("flowko_desk_history_cancelled", base));
    else continue;
    const overrides = Array.isArray(d.overrides) ? d.overrides.filter((k) => typeof k === "string") : [];
    if (overrides.length > 0) {
      const list = overrides.map((k) => t(`flowko_desk_override_${k}`)).join(", ");
      lines.push(t("flowko_desk_history_overrides", { list }));
    }
  }
  return lines;
}

export function BookingDetailsSheet(props: { booking: DeskBooking; onClose: () => void }) {
  const { t } = useLocale();
  const ctx = useDeskContext();
  const writes = useDeskWrites(ctx);
  const { booking, onClose } = props;
  const timeZone = ctx.view?.timeZone ?? "UTC";
  const startMs = ms(booking.start);

  // Flowko U28c (M2): the move panel, closed until „Prestavi“; date = the booking's business-local date, no time.
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(() => todayIn(timeZone, new Date(startMs)));
  const [moveTime, setMoveTime] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Flowko U28c (review): opening the panel brings it into view (it sits under the action row, below the fold on a
  // phone) and moves focus to its heading, so Tab goes straight to Datum. The heading, not Datum itself: focusing a
  // date input would pop the native date picker on phones.
  const panelRef = useRef<HTMLFormElement>(null);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!moveOpen) return;
    panelRef.current?.scrollIntoView?.({ block: "nearest" });
    panelTitleRef.current?.focus();
  }, [moveOpen]);

  const steps = booking.steps ?? [
    { kind: null, start: booking.start, end: booking.end, serviceName: booking.serviceNames.join(", ") },
  ];
  const history = historyLines(booking.actions, timeZone, t);

  const moveToField = async () => {
    let start: Ms;
    try {
      start = wallClockToMs(moveDate, moveTime, timeZone);
    } catch {
      setMoveError("flowko_desk_required_time");
      return;
    }
    setMoveError(null);
    setBusy(true);
    const outcome = await ctx.moveMode.moveTo(booking, start, { fieldCodes: ["in_past"] });
    setBusy(false);
    if (outcome.kind === "error" && outcome.code === "in_past") setMoveError(outcome.message);
  };

  const toggleNoShow = async () => {
    setBusy(true);
    await writes.noShow({ bookingId: booking.bookingId, noShow: !booking.noShow });
    setBusy(false);
  };

  const cancel = async () => {
    setBusy(true);
    const outcome = await writes.cancel({ bookingId: booking.bookingId, reason: reason.trim() || null });
    setBusy(false);
    if (outcome.kind === "done") {
      setCancelOpen(false);
      onClose();
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{booking.title}</SheetTitle>
          <p data-testid="desk-details-time" className="text-default text-sm">
            {dayjs(booking.start).tz(timeZone).format("D. M. YYYY")} · {formatHm(startMs, timeZone)}–
            {formatHm(ms(booking.end), timeZone)}
          </p>
          {booking.noShow && <Badge variant="orange">{t("flowko_desk_no_show_mark")}</Badge>}
        </SheetHeader>
        <SheetBody className="flex flex-col gap-5">
          <section className="flex flex-col gap-1">
            <h3 className="text-emphasis text-sm font-semibold">{t("flowko_desk_steps")}</h3>
            <ul className="text-default text-sm">
              {steps.map((s) => (
                <li key={s.start} data-testid="desk-details-step" className="tabular-nums">
                  {[
                    `${formatHm(ms(s.start), timeZone)}–${formatHm(ms(s.end), timeZone)}`,
                    s.serviceName,
                    s.kind ? t(`flowko_desk_step_${s.kind}`) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-1">
            <h3 className="text-emphasis text-sm font-semibold">{t("flowko_desk_customer")}</h3>
            <p className="text-default text-sm">{booking.customer.name}</p>
            {booking.customer.phone && (
              <a className="text-default text-sm underline" href={`tel:${booking.customer.phone}`}>
                {booking.customer.phone}
              </a>
            )}
            {booking.customer.email && (
              <a className="text-default text-sm underline" href={`mailto:${booking.customer.email}`}>
                {booking.customer.email}
              </a>
            )}
          </section>

          {(booking.mayMove || booking.mayReenter || booking.mayNoShow || booking.mayCancel) && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                {booking.mayMove && (
                  <Button
                    StartIcon="arrow-right"
                    aria-expanded={moveOpen}
                    onClick={() => {
                      // Flowko U28c (M2): opens the move panel below; the calendar mode is the panel's link.
                      setMoveError(null);
                      setMoveOpen(true);
                    }}>
                    {t("flowko_desk_move")}
                  </Button>
                )}
                {booking.mayReenter && (
                  <Button
                    color="secondary"
                    StartIcon="users"
                    onClick={() => {
                      ctx.setReenterFrom(booking);
                      onClose();
                    }}>
                    {t("flowko_desk_reenter")}
                  </Button>
                )}
                {booking.mayNoShow && (
                  <Button
                    color="secondary"
                    StartIcon={booking.noShow ? "rotate-ccw" : "user-x"}
                    disabled={busy}
                    onClick={() => void toggleNoShow()}>
                    {t(booking.noShow ? "flowko_desk_no_show_undo" : "flowko_desk_no_show_mark_action")}
                  </Button>
                )}
                {booking.mayCancel && (
                  <Button color="destructive" StartIcon="ban" onClick={() => setCancelOpen(true)}>
                    {t("flowko_desk_cancel_booking")}
                  </Button>
                )}
              </div>
              {booking.mayMove && moveOpen && (
                // Flowko U28c (M2, M3): the move panel; the details above stay visible. A form, so Enter confirms.
                <form
                  ref={panelRef}
                  data-testid="desk-move-panel"
                  className="border-default bg-muted flex flex-col gap-3 rounded-md border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!busy && moveTime !== "") void moveToField();
                  }}>
                  <h3
                    ref={panelTitleRef}
                    tabIndex={-1}
                    className="text-emphasis text-sm font-semibold outline-none">
                    {t("flowko_desk_move_panel_title")}
                  </h3>
                  <TextField
                    name="flowko-desk-move-date"
                    type="date"
                    label={t("date")}
                    value={moveDate}
                    onChange={(e) => setMoveDate(e.target.value)}
                  />
                  {booking.serviceIds === null ? (
                    <p data-testid="desk-move-services-gone" className="text-subtle text-sm">
                      {t("flowko_desk_move_services_gone")}
                    </p>
                  ) : (
                    localDateSchema.safeParse(moveDate).success && (
                      <FreeStartChips
                        date={moveDate}
                        serviceIds={booking.serviceIds}
                        memberId={booking.memberId}
                        timeZone={timeZone}
                        value={moveTime}
                        onPick={setMoveTime}
                      />
                    )
                  )}
                  <TextField
                    name="flowko-desk-move-time"
                    type="time"
                    label={t("time")}
                    step={(ctx.view?.slotStepMinutes ?? 15) * 60}
                    value={moveTime}
                    onChange={(e) => setMoveTime(e.target.value)}
                  />
                  {moveError && (
                    <p role="alert" className="text-error text-sm">
                      {t(moveError)}
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      color="secondary"
                      onClick={() => {
                        setMoveError(null);
                        setMoveOpen(false);
                      }}>
                      {t("cancel")}
                    </Button>
                    <Button type="submit" disabled={busy || moveTime === ""} loading={busy}>
                      {t("flowko_desk_move_confirm")}
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="text-subtle hover:text-emphasis self-start text-sm underline"
                    onClick={() => {
                      ctx.moveMode.start(booking);
                      onClose();
                    }}>
                    {t("flowko_desk_move_on_calendar")}
                  </button>
                </form>
              )}
            </section>
          )}

          {history.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="text-emphasis text-sm font-semibold">{t("flowko_desk_history")}</h3>
              <ul className="text-subtle text-sm">
                {history.map((line, i) => (
                  // History lines may repeat (two identical marks); the order is the identity.
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only list, never reordered
                  <li key={i} data-testid="desk-history-line">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </SheetBody>
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <ConfirmationDialogContent
            variety="danger"
            title={t("flowko_desk_cancel_booking")}
            cancelBtnText={t("cancel")}
            confirmBtn={
              <Button color="destructive" loading={busy} onClick={() => void cancel()}>
                {t("flowko_desk_cancel_booking")}
              </Button>
            }>
            <div className="mt-3">
              {/* Flowko U28: TextAreaField's label points at an id its textarea never gets; Label + TextArea do. */}
              <Label htmlFor="flowko-desk-cancel-reason">{t("flowko_desk_cancel_reason")}</Label>
              <TextArea
                id="flowko-desk-cancel-reason"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </ConfirmationDialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
