// Flowko U29d: the owner's invites (I1–I9): create (a brand-new person, C5, or a desk-only worker, C9), resend
// and new link (the same row gets a new token and 7 fresh days; the old link dies in the same UPDATE), revoke
// (the row stays, the link dies). Owner only (C2); the actor is the signed-in user, never a business id from input;
// a missing and a foreign invite or member answer the same `forbidden`. Only sha256(token) is stored (I2,
// inviteToken.ts); the raw token exists only in the answer's link and in the mail. "Has a Flowko login" (C6) =
// a user with that e-mail (case-insensitive, locked included) or a secondary e-mail; checked at create and resend
// (and inside the accept, inviteAccept.ts). One open invite per business + e-mail and per member (M1 partial
// uniques): the services check first; a unique violation is mapped outside the transaction (it aborts it).
// Locks (plan lock-order table): create = business row FOR NO KEY UPDATE -> stale invite rows -> insert; resend /
// new link / revoke = the invite row FOR UPDATE only. The mail goes after the commit, never inside a transaction;
// only "sent" counts as sent, everything else (skipped_*, a transport error, any throw) is `not_sent` and one log
// line that names the outcome or the error's name only (never the address, the token or a message). Server only.
import { formatHm } from "@calcom/lib/flowkoBusiness/desk";
import { isFlowkoDeskEmail } from "@calcom/lib/flowkoBusiness/deskEmail";
import {
  INVITE_TTL_MS,
  type InviteLinkAnswer,
  type InviteMailResult,
  type InviteRole,
  slInviteDate,
} from "@calcom/lib/flowkoBusiness/invites";
import { todayIn } from "@calcom/lib/flowkoBusiness/roster";
import { inviteEmailSchema } from "@calcom/lib/flowkoBusiness/schemas";
import logger from "@calcom/lib/logger";
import type { MailSendOutcome } from "@calcom/emails/templates/_base-email";
import { Prisma } from "@calcom/prisma/client";
import { FlowkoBusinessRole, FlowkoMemberStatus } from "@calcom/prisma/enums";
import { mayManageBusiness, requireBusinessAccess } from "./access";
import { displayNameOrThrow } from "./business";
import type { FlowkoDb } from "./db";
import { FlowkoBusinessError } from "./errors";
import { newInviteToken } from "./inviteToken";
import { memberTx } from "./memberTx";
import { lockBusinessRow, nameKey } from "./workers";

const log = logger.getSubLogger({ prefix: ["flowko-business-invites"] });

type Tx = Prisma.TransactionClient;

/** What the invite mail needs; `expiresDate` is the Slovene date with the year („pon., 23. 11. 2026“, E1). */
export type InviteMailArgs = {
  to: string;
  name: string;
  businessName: string;
  /** The business e-mail, or null: no Reply-To and no reply line (David 12 Nov, Open 6). */
  replyTo: string | null;
  link: string;
  expiresDate: string;
  expiresTime: string;
};

export type InviteDeps = {
  db: FlowkoDb;
  /** WEBAPP_URL in production, without a trailing slash. */
  baseUrl: string;
  sendInvite: (args: InviteMailArgs) => Promise<MailSendOutcome>;
};

export type CreateInviteInput =
  | { kind: "new"; name: string; email: string; role: InviteRole }
  | { kind: "member"; memberId: number; email: string };

/** The invite as written in the transaction, plus what the answer and the mail need after the commit. */
type Minted = {
  inviteId: number;
  token: string;
  email: string;
  name: string;
  expiresAt: Date;
  business: { name: string; email: string | null; timeZone: string };
};

/**
 * C6 (I4): a user with this e-mail (case-insensitive, locked users included) or a secondary e-mail with it.
 * `mode: "insensitive"` compiles to `ILIKE` with the value unescaped, so `_` and `%` in an address would be
 * wildcards (U29d SPEC-2: a false email_has_login and a cross-tenant oracle on other users' addresses). The query
 * only narrows; the answer is an exact lower-case compare here. No `take`: a cut could drop the exact match.
 */
export async function emailHasFlowkoLogin(tx: Tx, email: string): Promise<boolean> {
  const wanted = email.toLowerCase();
  const exact = (rows: Array<{ email: string }>) => rows.some((row) => row.email.toLowerCase() === wanted);
  const users = await tx.user.findMany({
    // `locked` in the where opts out of Cal's excludeLockedUsers extension (nameSpace.ts pattern).
    where: {
      email: { equals: email, mode: "insensitive" },
      OR: [{ locked: false }, { locked: true }],
    },
    select: { email: true },
  });
  if (exact(users)) return true;
  const secondary = await tx.secondaryEmail.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { email: true },
  });
  return exact(secondary);
}

const USERS_EMAIL_INDEX = "users_email_key";
const OPEN_INVITE_INDEXES = [
  "FlowkoBusinessInvite_one_open_per_email",
  "FlowkoBusinessInvite_one_open_per_member",
];

/**
 * Maps a unique violation (P2002) of the invite flow to its answer, reading both shapes: the classic `meta.target`
 * and the pg driver-adapter form (`meta.driverAdapterError.cause.constraint.{fields,index}`; the adapter carries
 * only the column list parsed from the Postgres detail, never the index name), quotes stripped, plus
 * `meta.modelName`. users.email -> email_has_login; an open invite per business + e-mail or per member ->
 * invite_pending; anything else -> null (the caller rethrows it).
 */
export function inviteUniqueConflictCode(error: unknown): "email_has_login" | "invite_pending" | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = (error.meta ?? {}) as {
    modelName?: unknown;
    target?: unknown;
    driverAdapterError?: {
      cause?: { constraint?: { fields?: unknown; index?: unknown } };
    };
  };
  const names = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.replace(/"/g, ""));
  const constraint = meta.driverAdapterError?.cause?.constraint;
  const indexes = [...names(meta.target), ...names(constraint?.index)];
  if (indexes.includes(USERS_EMAIL_INDEX)) return "email_has_login";
  if (indexes.some((name) => OPEN_INVITE_INDEXES.includes(name))) return "invite_pending";

  const fieldSets = [names(meta.target), names(constraint?.fields)].filter((set) => set.length > 0);
  const sameSet = (fields: string[], wanted: string[]) =>
    fields.length === wanted.length && wanted.every((name) => fields.includes(name));
  if (meta.modelName === "User" && fieldSets.some((set) => sameSet(set, ["email"]))) return "email_has_login";
  if (
    meta.modelName === "FlowkoBusinessInvite" &&
    fieldSets.some((set) => sameSet(set, ["businessId", "email"]) || sameSet(set, ["memberId"]))
  )
    return "invite_pending";
  return null;
}

/** memberTx, with an invite-flow unique violation (it aborts the Postgres transaction) mapped outside it. */
async function inviteTx<T>(db: FlowkoDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await memberTx(db, fn);
  } catch (e) {
    const code = inviteUniqueConflictCode(e);
    if (code) throw new FlowkoBusinessError(code);
    throw e;
  }
}

async function ownerAccess(tx: Tx, actorUserId: number) {
  const access = await requireBusinessAccess(tx, actorUserId);
  if (!mayManageBusiness(access)) throw new FlowkoBusinessError("forbidden");
  return access;
}

function emailOrThrow(raw: string): string {
  const parsed = inviteEmailSchema.safeParse(raw);
  if (!parsed.success) throw new FlowkoBusinessError("invite_bad_email");
  return parsed.data;
}

/** The business fields the answer and the mail need (read inside the transaction). */
async function businessFor(tx: Tx, businessId: number): Promise<Minted["business"]> {
  const business = await tx.flowkoBusiness.findUnique({
    where: { id: businessId },
    select: { name: true, email: true, timeZone: true },
  });
  if (!business) throw new FlowkoBusinessError("forbidden");
  return business;
}

/**
 * A desk-only member an invite may target (C9): in the actor's business (else forbidden, as missing), and an
 * ACTIVE WORKER whose user still has a desk e-mail (else member_not_desk_only).
 */
async function deskOnlyMemberOrThrow(
  tx: Tx,
  businessId: number,
  memberId: number
): Promise<{ displayName: string }> {
  const member = await tx.flowkoBusinessMember.findUnique({
    where: { id: memberId },
    select: {
      businessId: true,
      role: true,
      status: true,
      userId: true,
      displayName: true,
      user: { select: { email: true } },
    },
  });
  if (!member || member.businessId !== businessId) throw new FlowkoBusinessError("forbidden");
  if (
    member.role !== FlowkoBusinessRole.WORKER ||
    member.status !== FlowkoMemberStatus.ACTIVE ||
    member.userId === null ||
    !member.user ||
    !isFlowkoDeskEmail(member.user.email)
  )
    throw new FlowkoBusinessError("member_not_desk_only");
  return { displayName: member.displayName };
}

/** The business-local expiry: "YYYY-MM-DD" and "HH:mm" (W1 pattern, computed on the server). */
function localExpiry(minted: Minted): {
  expiresDate: string;
  expiresTime: string;
} {
  return {
    expiresDate: todayIn(minted.business.timeZone, minted.expiresAt),
    expiresTime: formatHm(minted.expiresAt.getTime(), minted.business.timeZone),
  };
}

/** E2: only "sent" is sent; any other outcome or any throw is not_sent plus one log line without data. */
async function sendInviteMail(deps: InviteDeps, minted: Minted, link: string): Promise<InviteMailResult> {
  const { expiresDate, expiresTime } = localExpiry(minted);
  const args: InviteMailArgs = {
    to: minted.email,
    name: minted.name,
    businessName: minted.business.name,
    replyTo: minted.business.email,
    link,
    expiresDate: slInviteDate(expiresDate),
    expiresTime,
  };
  try {
    const outcome = await deps.sendInvite(args);
    if (outcome === "sent") return "sent";
    log.warn("flowko_invite_mail_not_sent", { outcome });
  } catch (error) {
    log.warn("flowko_invite_mail_not_sent", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  return "not_sent";
}

function answerFor(minted: Minted, link: string, mail: InviteMailResult): InviteLinkAnswer {
  return { inviteId: minted.inviteId, link, mail, ...localExpiry(minted) };
}

const linkFor = (deps: InviteDeps, token: string) => `${deps.baseUrl}/auth/pridruzi/${token}`;

/**
 * I3: creates an invite and always mails it (C3). `kind: "new"`: a brand-new person (name 1..80 after trim,
 * bad_member; unique against every member of the business, member_name_taken; a pending invite does not reserve
 * its name, Open 7; role WORKER or STAFF, C5). `kind: "member"`: a desk-only worker of the business (the stored
 * name is the member's displayName; role WORKER). The e-mail must be real (invite_bad_email) and have no Flowko
 * login (email_has_login). An open, unexpired invite for the e-mail in this business or for the member is
 * invite_pending; open expired ones are revoked in the same transaction. Expiry = now + 7 days.
 */
export async function createInvite(
  deps: InviteDeps,
  actorUserId: number,
  input: CreateInviteInput,
  now: Date
): Promise<InviteLinkAnswer> {
  const minted = await inviteTx(deps.db, async (tx): Promise<Minted> => {
    const access = await ownerAccess(tx, actorUserId);
    let name: string | null = null;
    if (input.kind === "new") {
      if (input.role !== FlowkoBusinessRole.WORKER && input.role !== FlowkoBusinessRole.STAFF)
        throw new FlowkoBusinessError("bad_member");
      name = displayNameOrThrow(input.name);
    }
    const email = emailOrThrow(input.email);

    await lockBusinessRow(tx, access.businessId);
    let memberId: number | null = null;
    let role: InviteRole = input.kind === "new" ? input.role : "WORKER";
    if (input.kind === "member") {
      // Rights before C6: a foreign member answers forbidden whatever the e-mail.
      const member = await deskOnlyMemberOrThrow(tx, access.businessId, input.memberId);
      memberId = input.memberId;
      role = "WORKER";
      // The CHECK wants 1..80; a stored displayName is trimmed 1..80 by every writer, re-checked here.
      name = displayNameOrThrow(member.displayName);
    }
    if (await emailHasFlowkoLogin(tx, email)) throw new FlowkoBusinessError("email_has_login");
    if (input.kind === "new") {
      const members = await tx.flowkoBusinessMember.findMany({
        where: { businessId: access.businessId },
        select: { displayName: true },
      });
      const key = nameKey(name ?? "");
      if (members.some((m) => nameKey(m.displayName) === key))
        throw new FlowkoBusinessError("member_name_taken");
    }

    // I1: one open invite per business + e-mail and per member. Open = neither used nor revoked.
    const open = await tx.flowkoBusinessInvite.findMany({
      where: {
        usedAt: null,
        revokedAt: null,
        OR: [{ businessId: access.businessId, email }, ...(memberId === null ? [] : [{ memberId }])],
      },
      select: { id: true, expiresAt: true },
    });
    if (open.some((row) => row.expiresAt.getTime() > now.getTime()))
      throw new FlowkoBusinessError("invite_pending");
    if (open.length > 0) {
      // Only rows still expired and open at write time: a resend that rotated one of them meanwhile holds its row
      // lock; this UPDATE waits, re-checks the row and leaves it live. Then this create is invite_pending (a row
      // revoked by the owner's other device meanwhile is simply no longer open).
      const revoked = await tx.flowkoBusinessInvite.updateMany({
        where: {
          id: { in: open.map((row) => row.id) },
          usedAt: null,
          revokedAt: null,
          expiresAt: { lte: now },
        },
        data: { revokedAt: now },
      });
      if (revoked.count !== open.length) {
        const live = await tx.flowkoBusinessInvite.count({
          where: { id: { in: open.map((row) => row.id) }, usedAt: null, revokedAt: null },
        });
        if (live > 0) throw new FlowkoBusinessError("invite_pending");
      }
    }

    const { token, tokenHash } = newInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const row = await tx.flowkoBusinessInvite.create({
      data: {
        businessId: access.businessId,
        email,
        name: name ?? "",
        role,
        memberId,
        tokenHash,
        expiresAt,
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });
    return {
      inviteId: row.id,
      token,
      email,
      name: name ?? "",
      expiresAt,
      business: await businessFor(tx, access.businessId),
    };
  });

  const link = linkFor(deps, minted.token);
  const mail = await sendInviteMail(deps, minted, link);
  return answerFor(minted, link, mail);
}

/**
 * Locks an open invite of the actor's business for a change (resend, new link, revoke). The business is checked on
 * an unlocked read first (lock.ts managedMemberOrThrow pattern), so a foreign or missing id is `forbidden` before any
 * row lock; the locked re-read keeps the check (businessId never changes) and decides used / revoked.
 */
async function lockedInviteOrThrow(tx: Tx, businessId: number, inviteId: number) {
  const owner = await tx.flowkoBusinessInvite.findUnique({
    where: { id: inviteId },
    select: { businessId: true },
  });
  if (!owner || owner.businessId !== businessId) throw new FlowkoBusinessError("forbidden");
  await tx.$executeRaw`SELECT 1 FROM "FlowkoBusinessInvite" WHERE "id" = ${inviteId} FOR UPDATE`;
  const invite = await tx.flowkoBusinessInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      businessId: true,
      email: true,
      name: true,
      memberId: true,
      usedAt: true,
      revokedAt: true,
    },
  });
  if (!invite || invite.businessId !== businessId) throw new FlowkoBusinessError("forbidden");
  if (invite.usedAt !== null || invite.revokedAt !== null) throw new FlowkoBusinessError("invite_gone");
  return invite;
}

/**
 * I6: a new token and expiry (now + 7 days) on the same row (the old hash is replaced in the same UPDATE, so the
 * old link dies with this transaction); an expired open invite may be resent. `sendMail: true` = resend (mails
 * again), `false` = a new link to copy (mail "skipped"). Used or revoked = invite_gone; a member invite whose
 * member is no longer an ACTIVE desk-only worker = member_not_desk_only; C6 again (email_has_login).
 */
export async function resendInvite(
  deps: InviteDeps,
  actorUserId: number,
  input: { inviteId: number; sendMail: boolean },
  now: Date
): Promise<InviteLinkAnswer> {
  const minted = await inviteTx(deps.db, async (tx): Promise<Minted> => {
    const access = await ownerAccess(tx, actorUserId);
    const invite = await lockedInviteOrThrow(tx, access.businessId, input.inviteId);
    if (invite.memberId !== null) {
      try {
        await deskOnlyMemberOrThrow(tx, access.businessId, invite.memberId);
      } catch (e) {
        // The member link is this business's own invite: a member that moved away is not a rights question.
        if (e instanceof FlowkoBusinessError && e.code === "forbidden")
          throw new FlowkoBusinessError("member_not_desk_only");
        throw e;
      }
    }
    if (await emailHasFlowkoLogin(tx, invite.email)) throw new FlowkoBusinessError("email_has_login");

    const { token, tokenHash } = newInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await tx.flowkoBusinessInvite.update({
      where: { id: invite.id },
      data: { tokenHash, expiresAt },
    });
    return {
      inviteId: invite.id,
      token,
      email: invite.email,
      name: invite.name,
      expiresAt,
      business: await businessFor(tx, access.businessId),
    };
  });

  const link = linkFor(deps, minted.token);
  const mail: InviteMailResult = input.sendMail ? await sendInviteMail(deps, minted, link) : "skipped";
  return answerFor(minted, link, mail);
}

/** I7: `revokedAt = now`; the row stays (audit), the link dies at once. No mail. Used or revoked = invite_gone. */
export async function revokeInvite(
  db: FlowkoDb,
  actorUserId: number,
  input: { inviteId: number },
  now: Date
): Promise<{ status: "revoked" }> {
  return inviteTx(db, async (tx) => {
    const access = await ownerAccess(tx, actorUserId);
    const invite = await lockedInviteOrThrow(tx, access.businessId, input.inviteId);
    await tx.flowkoBusinessInvite.update({
      where: { id: invite.id },
      data: { revokedAt: now },
    });
    return { status: "revoked" as const };
  });
}
