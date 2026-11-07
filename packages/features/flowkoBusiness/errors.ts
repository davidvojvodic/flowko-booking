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
  | "roster_conflict";

export class FlowkoBusinessError extends Error {
  constructor(readonly code: FlowkoBusinessErrorCode) {
    super(code);
    this.name = "FlowkoBusinessError";
  }
}
