// Flowko U29c: viewer.flowko.workers.* (W11), the owner's "Delavci" page (pattern: U29a services router, lazy
// handler import). Rights live in the services (owner only). Flowko U29d (S1): invite, resendInvite and revokeInvite.
// Flowko U29e (E9): rename.
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import {
  ZAddDeskOnlyInput,
  ZInviteInput,
  ZLockMemberInput,
  ZRenameMemberInput,
  ZReorderWorkersInput,
  ZResendInviteInput,
  ZRevokeInviteInput,
  ZUnlockMemberInput,
} from "./workers.schema";

const load = () => import("./workers.handler");

export const workersRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return (await load()).listHandler({ ctx });
  }),
  lock: authedProcedure.input(ZLockMemberInput).mutation(async ({ ctx, input }) => {
    return (await load()).lockHandler({ ctx, input });
  }),
  unlock: authedProcedure.input(ZUnlockMemberInput).mutation(async ({ ctx, input }) => {
    return (await load()).unlockHandler({ ctx, input });
  }),
  addDeskOnly: authedProcedure.input(ZAddDeskOnlyInput).mutation(async ({ ctx, input }) => {
    return (await load()).addDeskOnlyHandler({ ctx, input });
  }),
  reorder: authedProcedure.input(ZReorderWorkersInput).mutation(async ({ ctx, input }) => {
    return (await load()).reorderHandler({ ctx, input });
  }),
  // Flowko U29d (S1): invites (I3, I6, I7).
  invite: authedProcedure.input(ZInviteInput).mutation(async ({ ctx, input }) => {
    return (await load()).inviteHandler({ ctx, input });
  }),
  resendInvite: authedProcedure.input(ZResendInviteInput).mutation(async ({ ctx, input }) => {
    return (await load()).resendInviteHandler({ ctx, input });
  }),
  revokeInvite: authedProcedure.input(ZRevokeInviteInput).mutation(async ({ ctx, input }) => {
    return (await load()).revokeInviteHandler({ ctx, input });
  }),
  // Flowko U29e (E9): the owner renames a member.
  rename: authedProcedure.input(ZRenameMemberInput).mutation(async ({ ctx, input }) => {
    return (await load()).renameHandler({ ctx, input });
  }),
});
