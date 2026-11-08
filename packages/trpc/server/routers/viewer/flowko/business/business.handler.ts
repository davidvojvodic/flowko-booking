// Flowko U27: handler of viewer.flowko.business.me. A user in no business (or a desk-only, locked or inactive member)
// gets null, not an error: the UI uses it to decide which screens to show. Not rate limited (one cheap read).
import { getBusinessAccess } from "@calcom/features/flowkoBusiness/access";
import { FlowkoBusinessRole } from "@calcom/prisma/enums";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import { flowkoTrpcError } from "../flowkoTrpcError";

type Ctx = { user: NonNullable<TrpcSessionUser> };

export async function meHandler({ ctx }: { ctx: Ctx }) {
  try {
    const access = await getBusinessAccess(prisma, ctx.user.id);
    if (!access) return null;
    const business = await prisma.flowkoBusiness.findUnique({
      where: { id: access.businessId },
      select: { name: true, slug: true },
    });
    if (!business) return null;
    return {
      businessId: access.businessId,
      businessName: business.name,
      businessSlug: business.slug,
      memberId: access.memberId,
      role: access.role,
      hidesCalScreens: access.role !== FlowkoBusinessRole.OWNER,
    };
  } catch (e) {
    return flowkoTrpcError(e);
  }
}
