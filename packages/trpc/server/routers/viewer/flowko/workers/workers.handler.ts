// Flowko U29c: handlers of viewer.flowko.workers.* (W11). Owner only (the services throw forbidden otherwise); the
// actor is always ctx.user.id (never from the input); every procedure, list included, passes the
// flowkoSettings:<id> limiter first; `now` is taken once per call; service errors map through flowkoTrpcError
// (forbidden → FORBIDDEN; member_not_locked, member_name_taken, member_conflict, owner_cannot_be_locked, bad_member
// → BAD_REQUEST with the code).
import { disconnectGoogleOfUser } from "@calcom/features/flowkoBusiness/disconnectGoogle";
import { lockMember, unlockMember } from "@calcom/features/flowkoBusiness/lock";
import { addDeskWorker, listWorkers, reorderWorkers } from "@calcom/features/flowkoBusiness/workers";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";
import type {
  TAddDeskOnlyInput,
  TLockMemberInput,
  TReorderWorkersInput,
  TUnlockMemberInput,
} from "./workers.schema";

type Ctx = { user: NonNullable<TrpcSessionUser> };
type Opts<T> = { ctx: Ctx; input: T };

async function limited(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({ identifier: `flowkoSettings:${ctx.user.id}`, rateLimitingType: "common" });
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

export async function listHandler({ ctx }: { ctx: Ctx }) {
  await limited(ctx);
  return guarded(() => listWorkers(prisma, ctx.user.id, new Date()));
}

export async function lockHandler({ ctx, input }: Opts<TLockMemberInput>) {
  await limited(ctx);
  return guarded(() =>
    lockMember(
      { db: prisma, disconnectGoogle: (userId: number) => disconnectGoogleOfUser(userId) },
      ctx.user.id,
      input.memberId,
      new Date()
    )
  );
}

export async function unlockHandler({ ctx, input }: Opts<TUnlockMemberInput>) {
  await limited(ctx);
  return guarded(() => unlockMember(prisma, ctx.user.id, input.memberId, new Date()));
}

export async function addDeskOnlyHandler({ ctx, input }: Opts<TAddDeskOnlyInput>) {
  await limited(ctx);
  return guarded(() => addDeskWorker(prisma, ctx.user.id, { displayName: input.displayName }));
}

export async function reorderHandler({ ctx, input }: Opts<TReorderWorkersInput>) {
  await limited(ctx);
  return guarded(() => reorderWorkers(prisma, ctx.user.id, { memberIds: input.memberIds }));
}
