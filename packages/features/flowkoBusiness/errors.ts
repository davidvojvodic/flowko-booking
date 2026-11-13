// Flowko U25: the one error the business services throw. The message is the code itself and never carries
// data (names, slugs, ids, e-mail addresses), so it is safe to log and to map to a user-facing text later.

export type FlowkoBusinessErrorCode =
  | "forbidden"
  | "name_invalid"
  | "name_reserved"
  | "name_taken"
  | "user_in_business"
  | "bad_member"
  | "bad_profile"
  | "template_unknown"
  | "owner_cannot_be_locked"
  // Flowko U26: roster services (roster.ts).
  | "bad_roster"
  | "week_out_of_range"
  | "outside_opening"
  | "bad_absence"
  | "not_a_holiday"
  | "same_week"
  | "roster_conflict"
  // Flowko U27: mirror and booking writer services (mirror.ts and the booking services).
  | "service_not_assigned"
  | "bad_customer"
  | "duplicate_time"
  | "not_business_booking"
  | "booking_not_active"
  | "worker_locked"
  | "bad_booking"
  // Flowko U28: the desk (R6 no booking in the past, D4 no-show only once the booking has started).
  | "in_past"
  | "booking_not_started"
  // Flowko U29a: owner settings and services (settings.ts, services.ts): a service name already used in the
  // business (case-insensitive), a service the editor rules refuse, settings changed since the form loaded them.
  | "service_name_taken"
  | "bad_service"
  | "settings_changed"
  // Flowko U29b: a roster row changed since the editor read it (the content-hash version differs, D8/D9).
  | "roster_changed"
  // Flowko U29c: the owner's Delavci writes: a worker name already used in the business (case-insensitive), and a
  // member write that lost a lock race, timed out or deadlocked (retryable), and an unlock of a member that is not
  // LOCKED (W3: never clears a Cal-admin lock of an ACTIVE member).
  | "member_name_taken"
  | "member_conflict"
  | "member_not_locked"
  // Flowko U29d: invites. The e-mail already has a Flowko login (C6: a user, locked included, or a secondary
  // e-mail); the invitee's e-mail is not a real address; an open invite already exists for that e-mail or member;
  // the invite is used or revoked (owner side); the public accept's one answer for unknown, expired, used, revoked
  // or ineligible (no oracle); the member is no longer an ACTIVE desk-only worker.
  | "email_has_login"
  | "invite_bad_email"
  | "invite_pending"
  | "invite_gone"
  | "invite_invalid"
  | "member_not_desk_only";

export class FlowkoBusinessError extends Error {
  constructor(readonly code: FlowkoBusinessErrorCode) {
    super(code);
    this.name = "FlowkoBusinessError";
  }
}
