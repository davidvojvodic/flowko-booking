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
  | "booking_not_started";

export class FlowkoBusinessError extends Error {
  constructor(readonly code: FlowkoBusinessErrorCode) {
    super(code);
    this.name = "FlowkoBusinessError";
  }
}
