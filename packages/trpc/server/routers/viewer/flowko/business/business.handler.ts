// Flowko U27: handler of viewer.flowko.business.me. A user in no business (or a desk-only, locked or inactive member)
// gets null, not an error: the UI uses it to decide which screens to show. Not rate limited (one cheap read).
// Flowko U29a: me carries the shared-device switch (S7); the owner's settings read/write (S2, S14) live here too.
import { getBusinessAccess } from "@calcom/features/flowkoBusiness/access";
import { listDeskMembers, listDeskServices } from "@calcom/features/flowkoBusiness/desk";
import { getBusinessSettings, updateBusinessSettings } from "@calcom/features/flowkoBusiness/settings"; // Flowko U29a
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";
import type { TUpdateSettingsInput } from "./business.schema"; // Flowko U29a

type Ctx = { user: NonNullable<TrpcSessionUser> };

export async function meHandler({ ctx }: { ctx: Ctx }) {
  try {
    const access = await getBusinessAccess(prisma, ctx.user.id);
    if (!access) return null;
    const business = await prisma.flowkoBusiness.findUnique({
      where: { id: access.businessId },
      select: { name: true, slug: true, sharedDevice: true }, // Flowko U29a: + sharedDevice (S7)
    });
    if (!business) return null;
    return {
      businessId: access.businessId,
      businessName: business.name,
      businessSlug: business.slug,
      memberId: access.memberId,
      role: access.role,
      hidesCalScreens: access.role !== FlowkoBusinessRole.OWNER,
      // Flowko U29a (S7): off = no actor chip on the desk; writes record the signed-in member.
      sharedDevice: business.sharedDevice === true,
    };
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

// Flowko U28: desk reads, own bucket (R13). Any business access; the services throw forbidden otherwise.
async function limitedDesk(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({
    identifier: `flowkoDesk:${ctx.user.id}`,
    rateLimitingType: "common",
  });
}

export async function servicesHandler({ ctx }: { ctx: Ctx }) {
  await limitedDesk(ctx);
  try {
    return await listDeskServices(prisma, ctx.user.id);
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

export async function membersHandler({ ctx }: { ctx: Ctx }) {
  await limitedDesk(ctx);
  try {
    return await listDeskMembers(prisma, ctx.user.id);
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

// Flowko U29a (S14): the owner's settings, own bucket. Owner only: the service throws forbidden otherwise.
async function limitedSettings(ctx: Ctx): Promise<void> {
  await checkRateLimitAndThrowError({
    identifier: `flowkoSettings:${ctx.user.id}`,
    rateLimitingType: "common",
  });
}

export async function settingsHandler({ ctx }: { ctx: Ctx }) {
  await limitedSettings(ctx);
  try {
    return await getBusinessSettings(prisma, ctx.user.id);
  } catch (e) {
    return flowkoTrpcError(e);
  }
}

/** `needs_confirm` (S3) comes back as data; settings_changed / bad_profile are BAD_REQUEST with the code. */
export async function updateSettingsHandler({ ctx, input }: { ctx: Ctx; input: TUpdateSettingsInput }) {
  await limitedSettings(ctx);
  try {
    return await updateBusinessSettings(
      prisma,
      ctx.user.id,
      {
        name: input.name,
        phone: input.phone,
        address: input.address,
        email: input.email,
        openingHours: input.openingHours,
        slotGridMinutes: input.slotGridMinutes,
        holidaysClosed: input.holidaysClosed,
        reminderOffsets: input.reminderOffsets,
        sharedDevice: input.sharedDevice,
        expectedUpdatedAt: input.expectedUpdatedAt,
        confirm: input.confirm,
      },
      new Date()
    );
  } catch (e) {
    return flowkoTrpcError(e);
  }
}
