// Flowko U29d: the invite types the owner's „Delavci“ page and the invite procedures share, client-safe (no server
// import, no `node:` import). The raw link exists only in an InviteLinkAnswer (the create / resend / new-link
// answer, shown once); the list types never carry a token, its hash or who created the invite. A desk-only
// member's invite (MemberInvite) carries no e-mail; a pending brand-new invite (PendingInvite) carries the address
// the owner typed. Expiry is decided on the server (`expired`); dates and times are business-local.
import { formatHm } from "./desk";
import { todayIn } from "./roster";

/** An invite link is valid for 7 days from its creation or its latest resend / new link (I5, I6). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteRole = "WORKER" | "STAFF";

export type MemberInvite = {
  inviteId: number;
  /** Business-local expiry date, "YYYY-MM-DD". */
  expiresDate: string;
  /** Business-local expiry time, "HH:mm". */
  expiresTime: string;
  /** expiresAt <= now on the server. */
  expired: boolean;
};

export type PendingInvite = MemberInvite & {
  name: string;
  email: string;
  role: InviteRole;
};

/** "skipped" = a new link without a mail (resend with sendMail false). */
export type InviteMailResult = "sent" | "not_sent" | "skipped";

export type InviteLinkAnswer = {
  inviteId: number;
  link: string;
  mail: InviteMailResult;
  expiresDate: string;
  expiresTime: string;
};

/** The business-local expiry of an invite and whether it has passed (`expiresAt > now` is the only valid). */
export function inviteExpiry(expiresAt: Date, timeZone: string, now: Date): Omit<MemberInvite, "inviteId"> {
  return {
    expiresDate: todayIn(timeZone, expiresAt),
    expiresTime: formatHm(expiresAt.getTime(), timeZone),
    expired: expiresAt.getTime() <= now.getTime(),
  };
}

const SL_WEEKDAYS_SHORT = ["ned.", "pon.", "tor.", "sre.", "čet.", "pet.", "sob."];

/**
 * A "YYYY-MM-DD" date the Slovene way: short weekday, day. month. and (when `withYear`) the year, e.g.
 * „pon., 23. 11. 2026“ (mail: always with the year, E1) or „pon., 23. 11.“. A fixed table, not Intl (ICU data
 * differs between Node builds).
 */
export function slInviteDate(isoDate: string, withYear = true): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = SL_WEEKDAYS_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${day}. ${month}.${withYear ? ` ${year}` : ""}`;
}
