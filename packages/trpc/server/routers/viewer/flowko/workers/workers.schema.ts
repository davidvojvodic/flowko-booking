// Flowko U29c: strict input shapes of viewer.flowko.workers.* (W11), the owner's "Delavci" page. Shapes, ids (int
// 1..2147483647) and generous size caps only: the display-name rules (trim, 80 characters, duplicates) live in
// addDeskWorker, so a refused name answers its code (member_name_taken) rather than a zod message. The actor is
// always ctx.user.id; `workers.list` takes no input.
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
