// Flowko U25: generator for the desk-only placeholder address. Server only (node:crypto); the client-safe
// constant and matcher are in packages/lib/flowkoBusiness/deskEmail.ts.
import { randomUUID } from "node:crypto";

import { FLOWKO_DESK_EMAIL_DOMAIN } from "@calcom/lib/flowkoBusiness/deskEmail";

/** A fresh, unique `desk-<uuid>@flowko.invalid`; satisfies User.email's unique constraint, never deliverable. */
export function makeDeskEmail(): string {
  return `desk-${randomUUID()}@${FLOWKO_DESK_EMAIL_DOMAIN}`;
}
