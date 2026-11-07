// Flowko U25: ends the session of a locked or deleted user on its next refresh (D1 strict lock, P4). Called by
// the next-auth `jwt` callback on a session refresh and on a useSession().update call; when it throws, next-auth
// answers /api/auth/session with an empty session and clears the cookie (JWT_SESSION_ERROR). The user is looked
// up by id (token.sub), never by e-mail, so an e-mail change signs nobody out. Uses the global client (P1
// exception: the caller in Cal code has no `db`); Cal's excludeLockedUsers extension adds locked=false to the
// lookup, so a Cal-locked user is not found. Server only.
import prisma from "@calcom/prisma";

/** The token's user is gone or locked. The message carries no id or address. */
export class FlowkoSessionEndedError extends Error {
  constructor() {
    super("The session's user is locked or no longer exists");
    this.name = "FlowkoSessionEndedError";
  }
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** Resolves when token.sub names an existing, unlocked user; throws FlowkoSessionEndedError otherwise. */
export async function assertSessionUserActive(token: { sub?: string | null }): Promise<void> {
  const sub = token.sub;
  if (typeof sub !== "string" || !POSITIVE_INTEGER.test(sub)) throw new FlowkoSessionEndedError();
  const id = Number(sub);
  if (!Number.isSafeInteger(id)) throw new FlowkoSessionEndedError();
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw new FlowkoSessionEndedError();
}
