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
  | "owner_cannot_be_locked";

export class FlowkoBusinessError extends Error {
  constructor(readonly code: FlowkoBusinessErrorCode) {
    super(code);
    this.name = "FlowkoBusinessError";
  }
}
