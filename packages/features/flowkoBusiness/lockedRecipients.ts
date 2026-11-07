// Flowko U25: which mail recipients belong to Cal-locked users (D1: no booking mail reaches a locked account;
// P6). BaseEmail.deliver drops these addresses from to/cc/bcc. A locked user's secondary e-mails count too
// (organizer mail can go to a secondary address, EventType.secondaryEmailId). Uses the global client (P1
// exception: BaseEmail has no `db`). Both queries name `locked` in their where, so the excludeLockedUsers
// extension does not hide the very users asked for. A failed lookup rejects: the caller sends nothing
// (Ruling 12, fail closed). Server only.
import { prisma } from "@calcom/prisma";

/**
 * The locked-recipient lookup failed. Carries the database error code only, never the cause: a Prisma error
 * message can quote the query's arguments, i.e. the recipients' addresses.
 */
export class FlowkoRecipientLookupError extends Error {
  readonly code: string | undefined;

  constructor(code?: string) {
    super("Locked-recipient lookup failed");
    this.name = "FlowkoRecipientLookupError";
    this.code = code;
  }
}

function codeOf(error: unknown): string | undefined {
  const { code } = (error ?? {}) as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

/** The lower-cased addresses among `addresses` that are a locked user's primary or secondary e-mail. */
export async function lockedRecipientAddresses(addresses: string[]): Promise<Set<string>> {
  const wanted = Array.from(new Set(addresses.filter((address) => address.length > 0)));
  if (wanted.length === 0) return new Set();
  const email = { in: wanted, mode: "insensitive" as const };
  try {
    const [users, secondaryEmails] = await Promise.all([
      prisma.user.findMany({ where: { locked: true, email }, select: { email: true } }),
      prisma.secondaryEmail.findMany({ where: { email, user: { locked: true } }, select: { email: true } }),
    ]);
    return new Set([...users, ...secondaryEmails].map((row) => row.email.toLowerCase()));
  } catch (error) {
    throw new FlowkoRecipientLookupError(codeOf(error));
  }
}
