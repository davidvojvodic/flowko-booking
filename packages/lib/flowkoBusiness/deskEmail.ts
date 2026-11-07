// Flowko U25: the never-deliverable placeholder address of a desk-only worker (a person with a column in the
// calendar but no login or mailbox). `.invalid` is reserved by RFC 2606, so no mail can ever reach it.
// Client-safe on purpose: isSmsCalEmail imports this and reaches client bundles (BookingListItem.tsx,
// bookings-single-view.tsx). Keep this file free of any module reference. The generator, which needs
// Node's crypto, lives in packages/features/flowkoBusiness/deskEmail.ts.

export const FLOWKO_DESK_EMAIL_DOMAIN = "flowko.invalid";

/** True when `email` is a desk-only placeholder address (case-insensitive suffix match on `@flowko.invalid`). */
export function isFlowkoDeskEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${FLOWKO_DESK_EMAIL_DOMAIN}`);
}
