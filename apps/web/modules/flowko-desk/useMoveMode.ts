// Flowko U28: move mode (R12). „Prestavi“ in the details sheet starts it; a tap in the same worker's column moves
// the booking there (taps in other columns are ignored), and so does the sheet's date + time field (`moveTo`).
// The state lives in the desk view, so it survives a date change (DateBar) and the switch to that worker's week:
// „move me to Thursday“ works. Esc or „Prekliči“ leaves it; success, or an answer that the booking can no longer
// move, leaves it too. A `needs_confirm` answer keeps the mode and holds the override dialog's data.
import { useCallback, useEffect, useState } from "react";

import type { DeskBooking } from "@calcom/features/flowkoBusiness/desk";
import type { FitProblem, Ms } from "@calcom/lib/flowkoSalon";

import type { DeskBookTarget } from "./WorkerColumn";
import type { DeskWriteOptions, DeskWriteOutcome, DeskWrites } from "./useDeskWrites";

export type MoveConfirm = {
  booking: DeskBooking;
  start: Ms;
  problems: FitProblem[];
  googleUnavailable: boolean;
  opts?: DeskWriteOptions;
};

export type MoveModeState = {
  /** The booking being moved by tapping; null outside move mode. */
  moving: DeskBooking | null;
  start: (booking: DeskBooking) => void;
  stop: () => void;
  /** A tap on the grid while moving: only the booking's own column counts. */
  tap: (target: DeskBookTarget) => void;
  /** Moves `booking` to `start` (also outside move mode: the details sheet's date + time field). */
  moveTo: (booking: DeskBooking, start: Ms, opts?: DeskWriteOptions) => Promise<DeskWriteOutcome<unknown>>;
  /** The override dialog's data after a `needs_confirm` answer (R8). */
  confirm: MoveConfirm | null;
  confirmOverride: () => Promise<void>;
  dismissConfirm: () => void;
};

/** Answers after which this booking cannot be moved at all: leave move mode. */
const ENDS_MOVE = new Set(["booking_not_active", "bad_booking", "worker_locked"]);

export function useMoveMode(writes: DeskWrites, options: { onMoved?: () => void } = {}): MoveModeState {
  const [moving, setMoving] = useState<DeskBooking | null>(null);
  const [confirm, setConfirm] = useState<MoveConfirm | null>(null);
  const { onMoved } = options;

  const stop = useCallback(() => setMoving(null), []);

  const send = useCallback(
    async (booking: DeskBooking, start: Ms, confirmOverride: boolean, opts?: DeskWriteOptions) => {
      const outcome = await writes.move(
        {
          bookingId: booking.bookingId,
          start: new Date(start).toISOString(),
          ...(confirmOverride && { confirmOverride: true }),
        },
        opts
      );
      if (outcome.kind === "confirm") {
        setConfirm({
          booking,
          start,
          problems: outcome.problems,
          googleUnavailable: outcome.googleUnavailable,
          opts,
        });
      } else if (outcome.kind === "done") {
        setMoving(null);
        onMoved?.();
      } else if (outcome.kind === "error" && ENDS_MOVE.has(outcome.code)) {
        setMoving(null);
      }
      return outcome;
    },
    [writes, onMoved]
  );

  const moveTo = useCallback(
    (booking: DeskBooking, start: Ms, opts?: DeskWriteOptions) => send(booking, start, false, opts),
    [send]
  );

  const tap = useCallback(
    (target: DeskBookTarget) => {
      if (!moving || target.memberId !== moving.memberId) return;
      void send(moving, target.start, false);
    },
    [moving, send]
  );

  const confirmOverride = useCallback(async () => {
    if (!confirm) return;
    setConfirm(null);
    await send(confirm.booking, confirm.start, true, confirm.opts);
  }, [confirm, send]);

  const dismissConfirm = useCallback(() => setConfirm(null), []);

  useEffect(() => {
    if (!moving || confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoving(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving, confirm]);

  return {
    moving,
    start: (booking: DeskBooking) => {
      setConfirm(null);
      setMoving(booking);
    },
    stop,
    tap,
    moveTo,
    confirm,
    confirmOverride,
    dismissConfirm,
  };
}
