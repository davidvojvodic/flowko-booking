// Flowko U29c: one row of the „Delavci“ list (W6). Name (+ „(vi)“ for the signed-in owner), role badge (OWNER
// „Lastnik“, WORKER „Delavec“, STAFF „Recepcija“), status badge (LOCKED > no login > active; every badge carries
// text, never colour alone), the order arrows (always shown; the caller disables them at the ends, while a write
// or refresh runs and while the on-screen list may be stale) and the action: none for the OWNER, „Zakleni“ for an ACTIVE member, „Odkleni“ for a LOCKED one
// (whose future bookings are listed under the row), plus „Prekini povezavo z Googlom“ on a row whose last lock could not
// remove the Google connection (this browser session only). The row wraps (flex-wrap) so a phone never scrolls
// sideways.
// Flowko U29d (U1, D1, I10): the status precedence is LOCKED > „Povabljen“ (open invite) > „Povabilo je poteklo“
// (expired invite) > no login > active. An ACTIVE desk-only WORKER without an invite gets „Povabi“ (C9; never a
// STAFF member without login, Open 9); with an invite its row shows the validity line (no e-mail: the address
// never reaches a member row) and „Pošlji znova“ / „Nova povezava“ / „Prekliči povabilo“ in place of „Povabi“.
// A LOCKED row hides all of it (its invite is inert until an unlock); „Zakleni“ / „Odkleni“ stay.
"use client";

import type { WorkerListRow } from "@calcom/lib/flowkoBusiness/workers";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import { useId } from "react";
import {
  InviteActions,
  type InviteActionHandlers,
  InviteStatusBadge,
  InviteValidity,
} from "./PendingInvites";
import { WorkerBookings } from "./WorkerBookings";

export type ArrowDirection = "up" | "down";

const roleKey = (role: WorkerListRow["role"]) =>
  role === "OWNER" ? "owner" : role === "WORKER" ? "flowko_desk_worker" : "flowko_workers_role_staff";

export function WorkerListItem(props: {
  row: WorkerListRow;
  isFirst: boolean;
  isLast: boolean;
  /** A write or refresh elsewhere on the page is running: arrows and actions are off. */
  busy: boolean;
  /** The list on screen may be stale (a refresh failed): the order arrows stay off, the actions keep working. */
  arrowsOff: boolean;
  /** This row's „Zakleni“ is refreshing the list before it opens the dialog. */
  preparing: boolean;
  /** The last lock of this row could not disconnect Google: „Prekini povezavo z Googlom“ is offered. */
  retryGoogle: boolean;
  currentYear: number;
  onMove: (direction: ArrowDirection) => void;
  onLock: () => void;
  onUnlock: () => void;
  onRetryGoogle: () => void;
  /** Flowko U29d: „Povabi“ (desk-only worker without an open invite). */
  onInvite: () => void;
  /** Flowko U29d: the actions on this row's open invite. */
  invite: InviteActionHandlers;
  /** The caller keeps the arrow buttons to put the focus back after a move. */
  arrowRef: (direction: ArrowDirection, element: HTMLElement | null) => void;
}) {
  const { t } = useLocale();
  const nameId = useId();
  const { row } = props;
  const locked = row.status === "LOCKED";
  const statusKey = locked
    ? "flowko_workers_status_locked"
    : row.noLogin
      ? "flowko_workers_status_no_login"
      : "flowko_workers_status_active";
  // Flowko U29d: the invite shows only on an ACTIVE row (a LOCKED member's invite is inert, I10).
  const invite = locked ? null : row.invite;
  const mayInvite = !locked && row.invite === null && row.role === "WORKER" && row.noLogin;

  return (
    <li
      data-testid={`flowko-worker-row-${row.memberId}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
      <div className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span id={nameId} className="text-emphasis break-words font-medium">
          {row.displayName}
        </span>
        {row.isMe && <span className="text-subtle text-sm">{t("flowko_workers_you")}</span>}
        <Badge variant="gray">{t(roleKey(row.role))}</Badge>
        {invite ? (
          <InviteStatusBadge invite={invite} />
        ) : (
          <Badge variant={locked ? "orange" : "blue"}>{t(statusKey)}</Badge>
        )}
        {invite && <InviteValidity invite={invite} currentYear={props.currentYear} className="w-full" />}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="icon"
          color="minimal"
          StartIcon="arrow-up"
          ref={(element) => props.arrowRef("up", element)}
          aria-label={t("flowko_workers_move_up", { name: row.displayName })}
          disabled={props.isFirst || props.busy || props.arrowsOff}
          onClick={() => props.onMove("up")}
        />
        <Button
          type="button"
          variant="icon"
          color="minimal"
          StartIcon="arrow-down"
          ref={(element) => props.arrowRef("down", element)}
          aria-label={t("flowko_workers_move_down", { name: row.displayName })}
          disabled={props.isLast || props.busy || props.arrowsOff}
          onClick={() => props.onMove("down")}
        />
        {props.retryGoogle && locked && (
          <Button type="button" color="secondary" disabled={props.busy} onClick={props.onRetryGoogle}>
            {t("flowko_workers_retry_google")}
          </Button>
        )}
        {invite && (
          <InviteActions
            busy={props.busy}
            describedBy={nameId}
            onResend={props.invite.onResend}
            onNewLink={props.invite.onNewLink}
            onRevoke={props.invite.onRevoke}
          />
        )}
        {mayInvite && (
          <Button
            type="button"
            color="secondary"
            aria-describedby={nameId}
            disabled={props.busy}
            onClick={props.onInvite}>
            {t("invite")}
          </Button>
        )}
        {row.role !== "OWNER" &&
          (locked ? (
            <Button
              type="button"
              color="secondary"
              aria-describedby={nameId}
              disabled={props.busy}
              onClick={props.onUnlock}>
              {t("flowko_workers_unlock")}
            </Button>
          ) : (
            <Button
              type="button"
              color="secondary"
              aria-describedby={nameId}
              loading={props.preparing}
              disabled={props.busy}
              onClick={props.onLock}>
              {t("flowko_workers_lock")}
            </Button>
          ))}
      </div>
      {locked && (
        <WorkerBookings
          bookings={row.futureBookings}
          more={row.moreBookings}
          currentYear={props.currentYear}
        />
      )}
    </li>
  );
}
