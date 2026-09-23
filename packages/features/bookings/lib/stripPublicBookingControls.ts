// Fields the booking service honours from the request body that only trusted callers may set.
// A public booker could otherwise suppress every confirmation email (noEmail), forge app results
// shown in emails (appsStatus) or pick round-robin hosts (luckyUsers).
const TRUSTED_ONLY_FIELDS = ["noEmail", "appsStatus", "luckyUsers"] as const;

export function stripPublicBookingControls<T extends Record<string, unknown>>(
  body: T
): Omit<T, (typeof TRUSTED_ONLY_FIELDS)[number]> {
  const publicBody = { ...body };
  for (const field of TRUSTED_ONLY_FIELDS) {
    delete publicBody[field];
  }
  return publicBody;
}
