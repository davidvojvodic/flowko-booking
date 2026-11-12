// Flowko U29d: the public side of an invite. `readInviteForAcceptPage` is the accept page's loader (A1): one
// `{ state: "invalid" }` for every token that cannot be accepted (malformed, unknown, used, revoked, expired,
// business gone, an ineligible desk-only member) so the page is no oracle, and no write of any kind (mail scanners
// open links). `acceptInvite` (A3) turns a brand-new invite into a login user + member in one transaction: the
// token is checked without a lock first (a dead token costs no bcrypt work), the password is hashed before the
// transaction (bcrypt never holds a lock), then business row FOR NO KEY UPDATE -> invite row FOR UPDATE -> re-read
// -> C6 again -> name -> users insert -> member insert (A4: a WORKER gets the owner's usual week, read now) -> the
// invite is used. A users e-mail unique violation aborts the Postgres transaction, so it is mapped after it
// (email_has_login). Never a Team, Membership, Profile, Host, Schedule, Credential or VerificationToken row; never
// Cal's UserCreationService or signup token path. The raw token never leaves this module (only its hash is read).
// The desk-only conversion (an invite with a member, D2) comes with U29d Task 4; until then it is refused as
// invite_invalid. Server only.
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import { usualWeekForCopy } from "@calcom/lib/flowkoBusiness/roster";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus, IdentityProvider } from "@calcom/prisma/enums";
import { displayNameOrThrow, FLOWKO_USER_DEFAULTS, nextPosition } from "./business";
import { FlowkoBusinessError } from "./errors";
import { hashInviteToken, isInviteTokenShape } from "./inviteToken";
import { emailHasFlowkoLogin, inviteUniqueConflictCode } from "./invites";
import { memberTx } from "./memberTx";
import { lockBusinessRow, nameKey } from "./workers";

type Tx = Prisma.TransactionClient;

/** What the accept page may show: nothing at all for an unusable token, else the invite's own data. */
export type AcceptPageInvite =
  | { state: "invalid" }
  | { state: "open"; businessName: string; email: string; name: string; kind: "new" | "member" };

export type AcceptDeps = { db: PrismaClient; hashPassword: (pw: string) => Promise<string> };

type OpenFields = { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date };

/** Neither used nor revoked and not expired at `now` (expired = `expiresAt <= now`, I5). */
const isOpen = (invite: OpenFields, now: Date): boolean =>
  invite.usedAt === null && invite.revokedAt === null && invite.expiresAt.getTime() > now.getTime();

const invalid = () => new FlowkoBusinessError("invite_invalid");

/**
 * A1 (loader): side-effect free. Answers exactly `{ state: "invalid" }` (no other key) for a malformed or unknown
 * token, a used, revoked or expired invite, and a member invite whose member is no longer an ACTIVE WORKER of the
 * business with an unlocked desk-only user; otherwise the business name, the invitee's e-mail and name, and the
 * kind (brand-new or desk-only member).
 */
export async function readInviteForAcceptPage(
  db: PrismaClient,
  token: string,
  now: Date
): Promise<AcceptPageInvite> {
  if (!isInviteTokenShape(token)) return { state: "invalid" };
  const invite = await db.flowkoBusinessInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      businessId: true,
      email: true,
      name: true,
      memberId: true,
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
      business: { select: { name: true } },
      member: {
        select: {
          businessId: true,
          role: true,
          status: true,
          user: { select: { email: true, locked: true } },
        },
      },
    },
  });
  if (!invite || !invite.business || !isOpen(invite, now)) return { state: "invalid" };
  if (invite.memberId !== null) {
    const member = invite.member;
    if (
      !member ||
      member.businessId !== invite.businessId ||
      member.role !== FlowkoBusinessRole.WORKER ||
      member.status !== FlowkoMemberStatus.ACTIVE ||
      !member.user ||
      member.user.locked ||
      !isFlowkoDeskEmail(member.user.email)
    )
      return { state: "invalid" };
  }
  return {
    state: "open",
    businessName: invite.business.name,
    email: invite.email,
    name: invite.name,
    kind: invite.memberId === null ? "new" : "member",
  };
}

/** memberTx (lock failures -> member_conflict) with a users e-mail unique violation mapped after the rollback. */
async function acceptTx<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await memberTx(db, fn);
  } catch (e) {
    if (inviteUniqueConflictCode(e) === "email_has_login") throw new FlowkoBusinessError("email_has_login");
    throw e;
  }
}

type PreRead = { id: number; businessId: number; tokenHash: string };

/**
 * A3 + A4, inside the transaction: business row FOR NO KEY UPDATE -> invite row FOR UPDATE -> re-read (same
 * business, same hash, brand-new, open; else invite_invalid) -> C6 (email_has_login) -> the name against every
 * member (member_name_taken) -> users insert -> member insert -> the invite used (a guarded update; count 1 or
 * invite_invalid, a belt over the row lock).
 */
async function acceptBrandNew(
  tx: Tx,
  pre: PreRead,
  name: string,
  passwordHash: string,
  now: Date
): Promise<{ status: "accepted"; email: string }> {
  await lockBusinessRow(tx, pre.businessId);
  await tx.$executeRaw`SELECT 1 FROM "FlowkoBusinessInvite" WHERE "id" = ${pre.id} FOR UPDATE`;
  const invite = await tx.flowkoBusinessInvite.findUnique({
    where: { id: pre.id },
    select: {
      businessId: true,
      email: true,
      role: true,
      memberId: true,
      tokenHash: true,
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (
    !invite ||
    invite.businessId !== pre.businessId ||
    invite.tokenHash !== pre.tokenHash ||
    invite.memberId !== null ||
    (invite.role !== FlowkoBusinessRole.WORKER && invite.role !== FlowkoBusinessRole.STAFF) ||
    !isOpen(invite, now)
  )
    throw invalid();

  if (await emailHasFlowkoLogin(tx, invite.email)) throw new FlowkoBusinessError("email_has_login");

  const members = await tx.flowkoBusinessMember.findMany({
    where: { businessId: invite.businessId },
    select: { displayName: true, role: true, usualWeek: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  const key = nameKey(name);
  if (members.some((m) => nameKey(m.displayName) === key)) throw new FlowkoBusinessError("member_name_taken");

  // A4 (C10): only a brand-new WORKER gets the owner's usual week, as stored now, when it passes the editor rules;
  // STAFF has no roster. None = SQL NULL. No service rows (services start empty).
  const owner = members.find((m) => m.role === FlowkoBusinessRole.OWNER);
  const usualWeek = invite.role === FlowkoBusinessRole.WORKER ? usualWeekForCopy(owner?.usualWeek) : null;

  const user = await tx.user.create({
    data: {
      email: invite.email,
      name,
      username: null,
      ...FLOWKO_USER_DEFAULTS,
      password: { create: { hash: passwordHash } },
      // Set with the password in one write (never a real-address user without a password: Google takeover).
      // A hand-copied link proves no mailbox (Open 29); null would send the login to /auth/verify-email (C13).
      emailVerified: now,
      identityProvider: IdentityProvider.CAL,
      completedOnboarding: true,
    },
    select: { id: true },
  });
  await tx.flowkoBusinessMember.create({
    data: {
      businessId: invite.businessId,
      userId: user.id,
      role: invite.role,
      displayName: name,
      position: await nextPosition(tx, invite.businessId), // the business row lock is already held
      usualWeek: usualWeek ?? Prisma.DbNull,
    },
    select: { id: true },
  });
  const used = await tx.flowkoBusinessInvite.updateMany({
    where: {
      id: pre.id,
      tokenHash: pre.tokenHash,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  if (used.count !== 1) throw invalid();
  return { status: "accepted", email: invite.email };
}

/**
 * A3: accepts an invite with the invitee's (editable) name and password. invite_invalid for every unusable token
 * (one code, no oracle; a dead token is answered before any bcrypt work); bad_member for a name that is empty or
 * longer than 80 characters after trim; email_has_login when the address meanwhile has a Flowko login (C6);
 * member_name_taken when the name is a member's; member_conflict for a lost lock race (retryable). The caller
 * (the public route) checks the password rules first. Answers the e-mail the new login signs in with.
 */
export async function acceptInvite(
  deps: AcceptDeps,
  input: { token: string; name: string; password: string },
  now: Date
): Promise<{ status: "accepted"; email: string }> {
  if (!isInviteTokenShape(input.token)) throw invalid();
  const tokenHash = hashInviteToken(input.token);
  const found = await deps.db.flowkoBusinessInvite.findUnique({
    where: { tokenHash },
    select: { id: true, businessId: true, memberId: true, usedAt: true, revokedAt: true, expiresAt: true },
  });
  if (!found || !isOpen(found, now)) throw invalid();
  // U29d Task 4 builds the desk-only conversion (D2); until then a member invite is not accepted.
  if (found.memberId !== null) throw invalid();
  const name = displayNameOrThrow(input.name);

  const passwordHash = await deps.hashPassword(input.password);
  const pre: PreRead = { id: found.id, businessId: found.businessId, tokenHash };
  return acceptTx(deps.db, (tx) => acceptBrandNew(tx, pre, name, passwordHash, now));
}
