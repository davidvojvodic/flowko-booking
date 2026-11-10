// Flowko U29c: the owner's „Delavci“ page (W6–W10), owner only (the page guards; the API refuses anyone else).
// Reads viewer.flowko.workers.list (no suspense, no server initial data) and lists every member in the order the
// server sends (the desk columns and Urnik rows follow it): see WorkerListItem. Writes, one at a time (a write or
// refresh keeps every arrow and action off until the refreshed list is in):
//  - „Zakleni“: refresh the list first and open the confirm dialog with the FRESH booking count (W7); when the
//    refresh fails there is no dialog and nothing is locked (generic error text). The dialog's „Zakleni“ locks,
//    toasts, refreshes; google: "failed" adds a warning toast and, until a reload, „Prekini Google“ on that row.
//  - „Odkleni“: no dialog (W9). Order arrows: send the whole new order (W5), „Shranjeno“ (P8); bad_member = the
//    order changed meanwhile (text + refetch). „Dodaj brez prijave“: AddDeskWorkerForm (W4).
// Errors per procedure as W10. A failed refresh after a saved write never undoes it: an inline „Osveži“ notice
// (P1), only the order arrows stay off until a refresh succeeds. The booking dates use the browser's current year only to decide whether to print the year.
"use client";

import type { WorkerListRow } from "@calcom/lib/flowkoBusiness/workers";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { SkeletonText } from "@calcom/ui/components/skeleton";
import { showToast } from "@calcom/ui/components/toast";
import { refreshAfterSave } from "@calcom/web/lib/flowko/refreshAfterSave";
import { useEffect, useRef, useState } from "react";
import { AddDeskWorkerForm, type AddWorkerResult } from "./AddDeskWorkerForm";
import { LockWorkerDialog } from "./LockWorkerDialog";
import { type ArrowDirection, WorkerListItem } from "./WorkerListItem";

const BOX = "border-subtle rounded-b-xl border border-t-0 px-4 py-8 sm:px-6";

const WORKER_CODES = [
  "forbidden",
  "owner_cannot_be_locked",
  "member_not_locked",
  "member_conflict",
  "bad_member",
  "member_name_taken",
] as const;
type WorkerCode = (typeof WORKER_CODES)[number] | "TOO_MANY_REQUESTS" | "unknown";

/** A write's error code: the Flowko code in `message` (flowkoTrpcError), else the tRPC code (rate limiter, FORBIDDEN). */
function workerErrorCode(error: unknown): WorkerCode {
  if (typeof error !== "object" || error === null) return "unknown";
  const { message, data } = error as { message?: unknown; data?: { code?: unknown } | null };
  const known = WORKER_CODES.find((code) => code === message);
  if (known) return known;
  if (data?.code === "TOO_MANY_REQUESTS") return "TOO_MANY_REQUESTS";
  if (data?.code === "FORBIDDEN") return "forbidden";
  return "unknown";
}

/** W10: the text of a lock, unlock, reorder or refresh error; rate limit and unknown codes use the generic texts. */
function errorKey(code: WorkerCode): string {
  switch (code) {
    case "forbidden":
    case "owner_cannot_be_locked":
    case "member_not_locked":
    case "member_conflict":
      return `flowko_workers_error_${code}`;
    case "TOO_MANY_REQUESTS":
      return "flowko_settings_error_TOO_MANY_REQUESTS";
    default:
      return "something_went_wrong";
  }
}

type FocusRequest = { memberId: number; direction: ArrowDirection; after: number | null };

export default function WorkersView() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const query = trpc.viewer.flowko.workers.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const lock = trpc.viewer.flowko.workers.lock.useMutation();
  const unlock = trpc.viewer.flowko.workers.unlock.useMutation();
  const addDeskOnly = trpc.viewer.flowko.workers.addDeskOnly.useMutation();
  const reorder = trpc.viewer.flowko.workers.reorder.useMutation();

  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [dialogFor, setDialogFor] = useState<number | null>(null);
  const [retryGoogle, setRetryGoogle] = useState<number[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const arrows = useRef(new Map<string, HTMLElement | null>());

  // P1: workers.list is the probe (invalidated with throwOnError, so it rejects when its refetch fails); the desk's
  // member and service lists only run alongside. A saved write is never undone by a failed refresh.
  const probeList = () =>
    utils.viewer.flowko.workers.list.invalidate(undefined, undefined, { throwOnError: true });
  async function refresh(): Promise<boolean> {
    const ok = await refreshAfterSave(probeList, [
      () => utils.viewer.flowko.business.members.invalidate(),
      () => utils.viewer.flowko.business.services.invalidate(),
    ]);
    setRefreshFailed(!ok);
    return ok;
  }
  async function retryRefresh() {
    setRetrying(true);
    try {
      setRefreshFailed(!(await refreshAfterSave(probeList, [])));
    } finally {
      setRetrying(false);
    }
  }

  /** One write or refresh at a time: everything else on the page stays off until it is done. */
  async function exclusive<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    if (inFlight.current) return fallback;
    inFlight.current = true;
    setBusy(true);
    try {
      return await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const members = query.data?.members;
  const dataUpdatedAt = query.dataUpdatedAt;

  // W6: after a move the focus stays on the same row's arrow, or on the other arrow when this one became disabled.
  // It waits for the refreshed list (dataUpdatedAt moved) so the row's new place decides.
  useEffect(() => {
    if (!focusRequest || busy || !members) return;
    if (focusRequest.after !== null && dataUpdatedAt === focusRequest.after) return;
    const index = members.findIndex((m) => m.memberId === focusRequest.memberId);
    if (index !== -1) {
      const off = (direction: ArrowDirection) =>
        direction === "up" ? index === 0 : index === members.length - 1;
      const wanted = off(focusRequest.direction)
        ? focusRequest.direction === "up"
          ? "down"
          : "up"
        : focusRequest.direction;
      arrows.current.get(`${focusRequest.memberId}:${wanted}`)?.focus();
    }
    setFocusRequest(null);
  }, [focusRequest, busy, members, dataUpdatedAt]);

  if (!query.data || !members) {
    if (query.error) {
      return (
        <div className={`${BOX} flex flex-col items-start gap-3`}>
          <p className="text-error text-sm">{t("something_went_wrong")}</p>
          <Button color="secondary" onClick={() => void query.refetch()}>
            {t("try_again")}
          </Button>
        </div>
      );
    }
    return (
      <div data-testid="flowko-workers-loading" className={`${BOX} flex flex-col gap-6`}>
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
        <SkeletonText className="h-8 w-full" />
      </div>
    );
  }

  const list = members; // narrowed for the handlers below
  const currentYear = new Date().getFullYear();

  // W7: refresh first; the dialog is built from the refreshed list (the row is looked up at render time).
  async function startLock(row: WorkerListRow) {
    await exclusive(async () => {
      setPreparing(row.memberId);
      let failure: unknown;
      const ok = await refreshAfterSave(async () => {
        try {
          await probeList();
        } catch (error) {
          failure = error;
          throw error;
        }
      }, []);
      setPreparing(null);
      if (!ok) {
        showToast(t(errorKey(workerErrorCode(failure))), "error");
        return;
      }
      setRefreshFailed(false);
      setDialogFor(row.memberId);
    }, undefined);
  }

  /** The lock itself (also the „Prekini Google“ retry: locking a LOCKED member runs the disconnect again). */
  async function lockMember(row: WorkerListRow) {
    await exclusive(async () => {
      let result: Awaited<ReturnType<typeof lock.mutateAsync>>;
      try {
        result = await lock.mutateAsync({ memberId: row.memberId });
      } catch (error) {
        showToast(t(errorKey(workerErrorCode(error))), "error");
        return;
      }
      showToast(t("flowko_workers_locked", { name: row.displayName }), "success");
      if (result.google === "failed") {
        showToast(t("flowko_workers_google_failed", { name: row.displayName }), "warning");
        setRetryGoogle((ids) => (ids.includes(row.memberId) ? ids : [...ids, row.memberId]));
      } else {
        setRetryGoogle((ids) => ids.filter((id) => id !== row.memberId));
      }
      await refresh();
    }, undefined);
  }

  async function unlockMember(row: WorkerListRow) {
    await exclusive(async () => {
      try {
        await unlock.mutateAsync({ memberId: row.memberId });
      } catch (error) {
        const code = workerErrorCode(error);
        showToast(t(errorKey(code)), "error");
        // W9: the person was not locked after all: the list was stale.
        if (code === "member_not_locked") await refresh();
        return;
      }
      showToast(t("flowko_workers_unlocked", { name: row.displayName }), "success");
      setRetryGoogle((ids) => ids.filter((id) => id !== row.memberId));
      await refresh();
    }, undefined);
  }

  async function move(index: number, direction: ArrowDirection) {
    const ids = list.map((m) => m.memberId);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + (direction === "up" ? -1 : 1), 0, moved);
    const stamp = dataUpdatedAt;
    await exclusive(async () => {
      let after: number | null = null;
      try {
        await reorder.mutateAsync({ memberIds: ids });
        // P8: the reorder went through, so it says so, whatever the refresh answers (P1).
        const ok = await refresh();
        showToast(t("saved"), "success");
        after = ok ? stamp : null;
      } catch (error) {
        const code = workerErrorCode(error);
        if (code === "bad_member") {
          // W5: the list was not exactly the business's members (another device added one).
          showToast(t("flowko_workers_error_order_changed"), "error");
          await query.refetch();
        } else {
          showToast(t(errorKey(code)), "error");
        }
      } finally {
        setFocusRequest({ memberId: moved, direction, after });
      }
    }, undefined);
  }

  async function addWorker(displayName: string): Promise<AddWorkerResult> {
    return exclusive<AddWorkerResult>(async () => {
      try {
        await addDeskOnly.mutateAsync({ displayName });
      } catch (error) {
        const code = workerErrorCode(error);
        if (code === "member_name_taken") return "member_name_taken";
        if (code === "bad_member") return "bad_name";
        showToast(t(errorKey(code)), "error");
        return "failed";
      }
      showToast(t("flowko_workers_added", { name: displayName }), "success");
      await refresh();
      return "ok";
    }, "failed");
  }

  const dialogRow = dialogFor === null ? undefined : members.find((m) => m.memberId === dialogFor);

  return (
    <div className={BOX}>
      {refreshFailed && (
        <div data-testid="flowko-workers-refresh-failed" role="alert" className="mb-4">
          <Alert
            severity="warning"
            title={t("flowko_settings_refresh_failed")}
            actions={
              <Button type="button" color="secondary" loading={retrying} onClick={() => void retryRefresh()}>
                {t("flowko_settings_refresh")}
              </Button>
            }
          />
        </div>
      )}
      <ul className="divide-subtle divide-y">
        {members.map((row, index) => (
          <WorkerListItem
            key={row.memberId}
            row={row}
            isFirst={index === 0}
            isLast={index === members.length - 1}
            busy={busy}
            arrowsOff={refreshFailed}
            preparing={preparing === row.memberId}
            retryGoogle={retryGoogle.includes(row.memberId)}
            currentYear={currentYear}
            onMove={(direction) => void move(index, direction)}
            onLock={() => void startLock(row)}
            onUnlock={() => void unlockMember(row)}
            onRetryGoogle={() => void lockMember(row)}
            arrowRef={(direction, element) => {
              arrows.current.set(`${row.memberId}:${direction}`, element);
            }}
          />
        ))}
      </ul>
      <AddDeskWorkerForm disabled={busy} onAdd={addWorker} />
      {dialogRow && (
        <LockWorkerDialog
          row={dialogRow}
          onClose={() => setDialogFor(null)}
          onConfirm={() => void lockMember(dialogRow)}
        />
      )}
    </div>
  );
}
