// Flowko U25: removes a locked worker's Google grants (R6): every google_calendar and google_video (Meet)
// credential of the user, through Cal's own delete path (handleDeleteCredential: revokes at Google, deletes the
// row and its selected calendars, and with the user's metadata clears a Google Meet defaultConferencingApp).
// That path uses the global client and calls Google, so it cannot join the lock transaction: lockMember runs it
// after the lock has committed, and a failure leaves the lock in effect (answer "failed"; locking again re-runs
// only this). Uses the global client (P1 exception). The delete path is imported lazily, only when there is
// something to delete (it loads the app store). Server only.
import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

export type GoogleDisconnect = "none" | "disconnected" | "failed";

type HandleDeleteCredential = typeof import("@calcom/features/credentials/handleDeleteCredential").default;

const GOOGLE_CREDENTIAL_TYPES = ["google_calendar", "google_video"];

const log = logger.getSubLogger({ prefix: ["flowko-disconnect-google"] });

/** The error's class and code only: messages from Google or Prisma can quote addresses. */
function loggable(error: unknown): { errorClass: string; code?: string } {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return {
    errorClass: typeof name === "string" ? name : typeof error,
    ...(typeof code === "string" && { code }),
  };
}

/**
 * "none" when the user has no Google credential, "disconnected" when every one was removed, "failed" when any
 * removal (or the lookup) threw; the other credentials are still tried. Never rejects.
 */
export async function disconnectGoogleOfUser(userId: number): Promise<GoogleDisconnect> {
  let credentials: { id: number }[];
  let userMetadata: Prisma.JsonValue;
  try {
    credentials = await prisma.credential.findMany({
      where: { userId, type: { in: GOOGLE_CREDENTIAL_TYPES } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (credentials.length === 0) return "none";
    // The user is Cal-locked by now: opt out of the excludeLockedUsers extension.
    const user = await prisma.user.findFirst({
      where: { id: userId, OR: [{ locked: false }, { locked: true }] },
      select: { metadata: true },
    });
    userMetadata = user?.metadata ?? null;
  } catch (error) {
    log.error("Google credential lookup failed", loggable(error));
    return "failed";
  }

  let handleDeleteCredential: HandleDeleteCredential;
  try {
    handleDeleteCredential = (await import("@calcom/features/credentials/handleDeleteCredential")).default;
  } catch (error) {
    log.error("Credential delete path not loaded", loggable(error));
    return "failed";
  }
  let failed = false;
  for (const credential of credentials) {
    try {
      await handleDeleteCredential({
        userId,
        userMetadata,
        credentialId: credential.id,
      });
    } catch (error) {
      failed = true;
      log.error("Google credential not removed", { credentialId: credential.id, ...loggable(error) });
    }
  }
  return failed ? "failed" : "disconnected";
}
