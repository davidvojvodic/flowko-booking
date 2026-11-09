// Flowko U29a: handlers of viewer.flowko.services.* (S8–S14). Owner only (the services throw forbidden otherwise);
// the actor is always ctx.user.id (never from the input); every procedure passes the flowkoSettings:<id> limiter
// first; service errors map through flowkoTrpcError (a reorder list with a foreign or unknown id is bad_service,
// a save/remove of another business's service forbidden: both the service's answers).
import {
  listServicesForOwner,
  removeService,
  reorderServices,
  saveService,
} from "@calcom/features/flowkoBusiness/services";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";
import type { TRemoveServiceInput, TReorderServicesInput, TSaveServiceInput } from "./services.schema";

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
  return guarded(() => listServicesForOwner(prisma, ctx.user.id, new Date()));
}

export async function saveHandler({ ctx, input }: Opts<TSaveServiceInput>) {
  await limited(ctx);
  return guarded(() =>
    saveService(prisma, ctx.user.id, {
      ...(input.id !== undefined ? { id: input.id } : {}),
      name: input.name,
      category: input.category,
      steps: input.steps,
      workerMemberIds: input.workerMemberIds,
    })
  );
}

export async function removeHandler({ ctx, input }: Opts<TRemoveServiceInput>) {
  await limited(ctx);
  return guarded(() => removeService(prisma, ctx.user.id, input.serviceId));
}

export async function reorderHandler({ ctx, input }: Opts<TReorderServicesInput>) {
  await limited(ctx);
  return guarded(() => reorderServices(prisma, ctx.user.id, input.serviceIds));
}
