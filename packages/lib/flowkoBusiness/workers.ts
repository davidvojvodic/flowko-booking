// Flowko U29c: the types of the owner's „Delavci“ list (workers.list), client-safe (no server import). A row is
// one business member as the owner sees it; the member's user id and e-mail never leave the server (isMe and
// noLogin are computed there). The bookings are the member's business bookings only (the mirror), and only for
// a LOCKED column member: date, local start and end, service names and the customer's name; never a uid, an
// e-mail or a phone number.
// Flowko U29d: a desk-only member's open invite (`invite`) carries its id and business-local expiry only, never the
// invitee's e-mail; only the pending brand-new invites (workers.list `invites`, PendingInvite in ./invites) carry
// an e-mail: the address the owner typed. No token, hash or creator anywhere.
import type { MemberInvite } from "./invites";

/** How many future bookings a LOCKED member's row lists; the rest is counted in `moreBookings`. */
export const WORKER_BOOKINGS_SHOWN = 50;

export type WorkerListBooking = {
  bookingId: number;
  /** Local start date in the business time zone, "YYYY-MM-DD". */
  date: string;
  /** Local "HH:mm". */
  from: string;
  to: string;
  /** Distinct service names in step order. */
  services: string[];
  customerName: string;
};

export type WorkerListRow = {
  memberId: number;
  displayName: string;
  role: "OWNER" | "WORKER" | "STAFF";
  status: "ACTIVE" | "LOCKED";
  /** Desk-only worker or staff without an account: nobody signs in as this person. */
  noLogin: boolean;
  isMe: boolean;
  /** Future business bookings in this member's column (0 for STAFF and for a member who never had one). */
  futureCount: number;
  /** Only for a LOCKED column member; [] otherwise. */
  futureBookings: WorkerListBooking[];
  /**
   * Flowko U29c: 0 for a row without a bookings list (ACTIVE, STAFF); for a LOCKED row futureCount minus the
   * bookings listed (never negative).
   */
  moreBookings: number;
  /** Flowko U29d: the member's open invite (desk-only worker, C9), or null. No e-mail. */
  invite: MemberInvite | null;
};
