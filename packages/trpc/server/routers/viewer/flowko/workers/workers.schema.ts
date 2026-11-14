// Flowko U29c: strict input shapes of viewer.flowko.workers.* (W11), the owner's "Delavci" page. Shapes, ids (int
// 1..2147483647) and generous size caps only: the display-name rules (trim, 80 characters, duplicates) live in
// addDeskWorker, so a refused name answers its code (member_name_taken) rather than a zod message. The actor is
// always ctx.user.id; `workers.list` takes no input. Flowko U29d (I8, S1): the invite inputs follow the same rule: shapes
// and generous caps only (the e-mail format and its 254-character rule, the name rules and every right live in the
// invite service), no business, actor, user or token from the client, role never OWNER.
// Flowko U29e (E9, R8): the rename input follows the same rule (the name rules live in renameMember).
import { z } from "zod";

const MAX_INT4 = 2147483647;
const idSchema = z.number().int().positive().max(MAX_INT4);
const NAME_MAX = 200;
const MEMBERS_MAX = 500;

export const ZLockMemberInput = z.object({ memberId: idSchema }).strict();
export type TLockMemberInput = z.infer<typeof ZLockMemberInput>;

export const ZUnlockMemberInput = z.object({ memberId: idSchema }).strict();
export type TUnlockMemberInput = z.infer<typeof ZUnlockMemberInput>;

export const ZAddDeskOnlyInput = z.object({ displayName: z.string().max(NAME_MAX) }).strict();
export type TAddDeskOnlyInput = z.infer<typeof ZAddDeskOnlyInput>;

export const ZReorderWorkersInput = z
  .object({ memberIds: z.array(idSchema).min(1).max(MEMBERS_MAX) })
  .strict();
export type TReorderWorkersInput = z.infer<typeof ZReorderWorkersInput>;

// Flowko U29e (E9, R8): the owner renames a member.
export const ZRenameMemberInput = z
  .object({ memberId: idSchema, displayName: z.string().max(NAME_MAX) })
  .strict();
export type TRenameMemberInput = z.infer<typeof ZRenameMemberInput>;

// Flowko U29d (I3): a brand-new person (name, e-mail, role Delavec or Recepcija, C5) or a desk-only member who gets a
// login (C9). The e-mail cap of 320 is the RFC maximum; the service refuses anything over 254 as invite_bad_email.
const EMAIL_MAX = 320;
export const ZInviteInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("new"),
      name: z.string().max(NAME_MAX),
      email: z.string().max(EMAIL_MAX),
      role: z.enum(["WORKER", "STAFF"]),
    })
    .strict(),
  z.object({ kind: z.literal("member"), memberId: idSchema, email: z.string().max(EMAIL_MAX) }).strict(),
]);
export type TInviteInput = z.infer<typeof ZInviteInput>;

// Flowko U29d (I6): sendMail true = "Pošlji znova", false = "Nova povezava" (a new link, no mail).
export const ZResendInviteInput = z.object({ inviteId: idSchema, sendMail: z.boolean() }).strict();
export type TResendInviteInput = z.infer<typeof ZResendInviteInput>;

export const ZRevokeInviteInput = z.object({ inviteId: idSchema }).strict();
export type TRevokeInviteInput = z.infer<typeof ZRevokeInviteInput>;
