// Flowko U28: the desk's writes (R9, R13). Every write names the actor at the device (`actorMemberId`, a label,
// never a right). A `needs_confirm` answer and every error refetch the shown day BEFORE the caller shows a dialog
// or a message, so a booking another tablet just made is drawn under it. Each error code has its own text
// `flowko_desk_error_<code>`; codes the caller shows at a field (`fieldCodes`) come back without a toast.
// `forbidden` clears the stored actor (the chosen member may have been locked meanwhile; a fixed WORKER gets
// `flowko_desk_error_forbidden_self` instead). Success invalidates every day and week view.
// Flowko U28b (B1, B3): no picker opens from a write: the actor defaults to the signed-in member, and `forbidden`
// only clears the stored choice (back to herself) and shows its text. The refetch before a dialog or a message
// refreshes the shown free starts too (the success path's `invalidate` covers them, useDeskData).
// Flowko U29e (E6, R10): `cancel` takes an optional `handoverToMemberId` (the re-enter's new worker); sent only when
// given, so an ordinary cancel's payload is unchanged.
import type { FitProblem } from "@calcom/lib/flowkoSalon";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { showToast } from "@calcom/ui/components/toast";

import type { DeskContextValue } from "./DeskContext";

export const DESK_WRITE_CODES = [
  "in_past",
  "bad_customer",
  "duplicate_time",
  "booking_not_active",
  "worker_locked",
  "service_not_assigned",
  "bad_booking",
  "booking_not_started",
  "forbidden",
  "TOO_MANY_REQUESTS",
] as const;
export type DeskWriteCode = (typeof DESK_WRITE_CODES)[number];

export type DeskWriteOutcome<R> =
  | { kind: "done"; result: R }
  | { kind: "confirm"; problems: FitProblem[]; googleUnavailable: boolean }
  /** `message` is the i18n key of the code's text. */
  | { kind: "error"; code: DeskWriteCode | "unknown"; message: string }
  /** Flowko U28b (B1): the actor is not known yet (member list loading or failed): nothing was sent. */
  | { kind: "needs_actor" };

export type DeskWriteOptions = {
  /** Codes the caller shows at a field: returned without a toast. */
  fieldCodes?: readonly DeskWriteCode[];
  /** Which toasts this hook shows (default all); the caller says the rest (re-enter). */
  toasts?: "all" | "errors" | "none";
};

export type DeskWriteDeps = Pick<DeskContextValue, "actor" | "refetch" | "invalidate">;

type Customer = { name: string; phone?: string | null; email?: string | null };
export type DeskCreateInput = {
  workerMemberId: number;
  serviceIds: number[];
  /** UTC ISO instant ("…Z"). */
  start: string;
  customer: Customer;
  confirmOverride?: boolean;
};
export type DeskMoveInput = { bookingId: number; start: string; confirmOverride?: boolean };

type NeedsConfirm = { status: "needs_confirm"; problems: FitProblem[]; googleUnavailable: boolean };
type Written = { status: string };

export type DeskWrites = {
  create: (input: DeskCreateInput, opts?: DeskWriteOptions) => Promise<DeskWriteOutcome<Written>>;
  move: (input: DeskMoveInput, opts?: DeskWriteOptions) => Promise<DeskWriteOutcome<Written>>;
  cancel: (
    input: { bookingId: number; reason?: string | null; handoverToMemberId?: number },
    opts?: DeskWriteOptions
  ) => Promise<DeskWriteOutcome<Written>>;
  noShow: (
    input: { bookingId: number; noShow: boolean },
    opts?: DeskWriteOptions
  ) => Promise<DeskWriteOutcome<Written>>;
};

const isCode = (value: unknown): value is DeskWriteCode =>
  typeof value === "string" && (DESK_WRITE_CODES as readonly string[]).includes(value);

/** The write's error code: the Flowko code in `message` (flowkoTrpcError), else the tRPC code (rate limiter). */
export function deskErrorCode(error: unknown): DeskWriteCode | "unknown" {
  if (typeof error !== "object" || error === null) return "unknown";
  const { message, data } = error as { message?: unknown; data?: { code?: unknown } | null };
  if (isCode(message)) return message;
  if (isCode(data?.code)) return data.code;
  return "unknown";
}

const errorKey = (code: DeskWriteCode | "unknown") =>
  code === "unknown" ? "something_went_wrong" : `flowko_desk_error_${code}`;

const needsConfirm = (result: Written): result is NeedsConfirm => result.status === "needs_confirm";

export function useDeskWrites(deps: DeskWriteDeps): DeskWrites {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { actor, refetch, invalidate } = deps;
  const createMutation = trpc.viewer.flowko.bookings.create.useMutation();
  const moveMutation = trpc.viewer.flowko.bookings.move.useMutation();
  const cancelMutation = trpc.viewer.flowko.bookings.cancel.useMutation();
  const noShowMutation = trpc.viewer.flowko.bookings.noShow.useMutation();

  // R13: the day is fresh before any dialog or message; a failed refetch must not hide the write's answer.
  // Flowko U28b (B3): the shown free starts (an open booking sheet's chips) are refetched with the day.
  const refresh = () =>
    Promise.all([
      Promise.resolve()
        .then(() => refetch())
        .catch(() => undefined),
      Promise.resolve()
        .then(() => utils.viewer.flowko.bookings.freeStarts.refetch())
        .catch(() => undefined),
    ]);

  async function run(
    send: (actorMemberId: number) => Promise<Written>,
    successKey: string,
    opts: DeskWriteOptions = {}
  ): Promise<DeskWriteOutcome<Written>> {
    const chosen = actor.actor;
    if (!chosen) {
      // Flowko U28b (B1): never a forced picker; the desk is not ready to say who acts, so nothing is sent.
      if (opts.toasts !== "none") showToast(t("flowko_desk_load_error"), "error");
      return { kind: "needs_actor" };
    }
    let result: Written;
    try {
      result = await send(chosen.memberId);
    } catch (error) {
      const code = deskErrorCode(error);
      await refresh();
      // Flowko U28b (B1): forget the stored choice (back to the signed-in member), no picker.
      if (code === "forbidden") actor.clear();
      // A WORKER is fixed to herself: no picker to offer, so her text does not ask her to choose.
      const message = code === "forbidden" && actor.fixed ? "flowko_desk_error_forbidden_self" : errorKey(code);
      const atField = code !== "unknown" && opts.fieldCodes?.includes(code);
      if (opts.toasts !== "none" && !atField) showToast(t(message), "error");
      return { kind: "error", code, message };
    }
    if (needsConfirm(result)) {
      // No blind „Vseeno shrani“ over a booking this desk has not drawn yet.
      await refresh();
      return { kind: "confirm", problems: result.problems, googleUnavailable: result.googleUnavailable };
    }
    void Promise.resolve()
      .then(() => invalidate())
      .catch(() => undefined);
    if ((opts.toasts ?? "all") === "all") showToast(t(successKey), "success");
    return { kind: "done", result };
  }

  return {
    create: (input, opts) =>
      run(
        (actorMemberId) =>
          createMutation.mutateAsync({
            workerMemberId: input.workerMemberId,
            serviceIds: input.serviceIds,
            start: input.start,
            customer: input.customer,
            confirmOverride: input.confirmOverride ?? false,
            actorMemberId,
          }),
        "flowko_desk_created",
        opts
      ),
    move: (input, opts) =>
      run(
        (actorMemberId) =>
          moveMutation.mutateAsync({
            bookingId: input.bookingId,
            start: input.start,
            confirmOverride: input.confirmOverride ?? false,
            actorMemberId,
          }),
        "flowko_desk_moved",
        opts
      ),
    cancel: (input, opts) =>
      run(
        (actorMemberId) => cancelMutation.mutateAsync({ ...input, actorMemberId }),
        "flowko_desk_cancelled",
        opts
      ),
    noShow: (input, opts) =>
      run(
        (actorMemberId) => noShowMutation.mutateAsync({ ...input, actorMemberId }),
        input.noShow ? "flowko_desk_no_show_marked" : "flowko_desk_no_show_undone",
        opts
      ),
  };
}
