// Flowko U29d: the invite token (I2). 32 random bytes (256 bits) as base64url = 43 characters [A-Za-z0-9_-]; the
// database stores only its sha256 as lower-case hex (`tokenHash`, CHECK FlowkoBusinessInvite_tokenHash_sha256).
// The raw token lives only in memory between creation and the owner's answer, and in the mail; it is never
// stored, logged or listed. A lookup is findUnique on the unique tokenHash (no timing compare needed). Server only.
import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The sha256 hex of the token's UTF-8 bytes, as stored in FlowkoBusinessInvite.tokenHash. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh token and the hash to store. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

/** True for exactly 43 base64url characters; anything else is refused before any lookup. */
export function isInviteTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}
