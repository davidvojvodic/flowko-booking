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
  // member write that lost a lock race, timed out or deadlocked (retryable; Task 4 adds member_not_locked).
  | "member_name_taken"
  | "member_conflict";

export class FlowkoBusinessError extends Error {
  constructor(readonly code: FlowkoBusinessErrorCode) {
    super(code);
    this.name = "FlowkoBusinessError";
  }
}
