// Flowko U29d: open invites on the owner's „Delavci“ page (U1, C4). „Povabljeni“ lists the open invites of brand-new
// people (no member exists until they accept, so these rows are not member rows: no arrows, never in the order the
// page sends): name, role badge (Delavec / Recepcija), status badge („Povabljen“, or „Povabilo je poteklo“ once the
// server says expired), the address the owner typed, the validity line and „Pošlji znova“ / „Nova povezava“ /
// „Prekliči povabilo“. The validity line and the three actions are shared with a desk-only member's row
// (WorkerListItem). Expiry is the server's (`expired`, business-local date and time); the year is printed only when
// it differs from the browser's current year (R18). Badges carry text, rows wrap (phone-safe).
"use client";

import type { MemberInvite, PendingInvite } from "@calcom/lib/flowkoBusiness/invites";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import { useId } from "react";
import { dayText } from "./WorkerBookings";

/** „Povabljen“ (green) or „Povabilo je poteklo“ (orange). */
export function InviteStatusBadge(props: { invite: MemberInvite }) {
  const { t } = useLocale();
  return props.invite.expired ? (
    <Badge variant="orange">{t("flowko_invite_status_expired")}</Badge>
  ) : (
    <Badge variant="green">{t("flowko_invite_status_pending")}</Badge>
  );
}

/** „velja do pon., 23. 11. ob 08:07“ / „poteklo …“ in the business's local date and time. */
export function InviteValidity(props: { invite: MemberInvite; currentYear: number; className?: string }) {
  const { t, i18n } = useLocale();
  const { invite } = props;
  const year = Number(invite.expiresDate.slice(0, 4));
  const date = dayText(invite.expiresDate, i18n?.language ?? "sl", year !== props.currentYear);
  return (
    <p className={`text-subtle text-sm tabular-nums ${props.className ?? ""}`}>
      {t(invite.expired ? "flowko_invite_expired_on" : "flowko_invite_valid_until", {
        date,
        time: invite.expiresTime,
        // i18next would escape the „/“ of an English date; React escapes once.
        interpolation: { escapeValue: false },
      })}
    </p>
  );
}

export type InviteActionHandlers = {
  onResend: () => void;
  onNewLink: () => void;
  onRevoke: () => void;
};

/** „Pošlji znova“, „Nova povezava“, „Prekliči povabilo“; each announced with the person's name. */
export function InviteActions(props: InviteActionHandlers & { busy: boolean; describedBy: string }) {
  const { t } = useLocale();
  return (
    <>
      <Button
        type="button"
        color="secondary"
        aria-describedby={props.describedBy}
        disabled={props.busy}
        onClick={props.onResend}>
        {t("resend")}
      </Button>
      <Button
        type="button"
        color="secondary"
        aria-describedby={props.describedBy}
        disabled={props.busy}
        onClick={props.onNewLink}>
        {t("flowko_invite_new_link")}
      </Button>
      <Button
        type="button"
        color="secondary"
        aria-describedby={props.describedBy}
        disabled={props.busy}
        onClick={props.onRevoke}>
        {t("flowko_invite_revoke")}
      </Button>
    </>
  );
}

function PendingInviteRow(
  props: { invite: PendingInvite; busy: boolean; currentYear: number } & InviteActionHandlers
) {
  const { t } = useLocale();
  const nameId = useId();
  const { invite } = props;
  return (
    <li
      data-testid={`flowko-invite-row-${invite.inviteId}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
      <div className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span id={nameId} className="text-emphasis break-words font-medium">
          {invite.name}
        </span>
        <Badge variant="gray">
          {t(invite.role === "WORKER" ? "flowko_desk_worker" : "flowko_workers_role_staff")}
        </Badge>
        <InviteStatusBadge invite={invite} />
        <span className="text-default w-full break-all text-sm">{invite.email}</span>
        <InviteValidity invite={invite} currentYear={props.currentYear} className="w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <InviteActions
          busy={props.busy}
          describedBy={nameId}
          onResend={props.onResend}
          onNewLink={props.onNewLink}
          onRevoke={props.onRevoke}
        />
      </div>
    </li>
  );
}

export function PendingInvites(props: {
  invites: readonly PendingInvite[];
  /** A write or refresh elsewhere on the page is running: the actions are off. */
  busy: boolean;
  currentYear: number;
  onResend: (invite: PendingInvite) => void;
  onNewLink: (invite: PendingInvite) => void;
  onRevoke: (invite: PendingInvite) => void;
}) {
  const { t } = useLocale();
  const titleId = useId();
  if (props.invites.length === 0) return null;
  return (
    <section
      data-testid="flowko-invites-pending"
      aria-labelledby={titleId}
      className="border-subtle mt-8 border-t pt-6">
      <h2 id={titleId} className="text-emphasis text-base font-semibold">
        {t("flowko_invite_pending_title")}
      </h2>
      <ul className="divide-subtle divide-y">
        {props.invites.map((invite) => (
          <PendingInviteRow
            key={invite.inviteId}
            invite={invite}
            busy={props.busy}
            currentYear={props.currentYear}
            onResend={() => props.onResend(invite)}
            onNewLink={() => props.onNewLink(invite)}
            onRevoke={() => props.onRevoke(invite)}
          />
        ))}
      </ul>
    </section>
  );
}
