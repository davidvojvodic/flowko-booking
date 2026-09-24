import type { GetServerSidePropsContext } from "next";

import { getServerSession } from "@calcom/feature-auth/lib/getServerSession";
import { isActiveInstanceAdminSession } from "@calcom/feature-auth/lib/isActiveInstanceAdmin";
import { getOptions } from "@calcom/feature-auth/lib/next-auth-options";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { getTrackingFromCookies } from "@calcom/lib/tracking";
import prisma from "@calcom/prisma";

export const getServerSideProps = async (context: GetServerSidePropsContext) => {
  const session = await getServerSession({
    req: context.req,
    authOptions: getOptions({
      getDubId: () => context.req.cookies.dub_id || context.req.cookies.dclid,
      getTrackingData: () => getTrackingFromCookies(context.req.cookies),
    }),
  });
  // Disable this check if we ever make this self serve.
  if (session?.user.role !== "ADMIN") {
    return {
      notFound: true,
    } as const;
  }
  // Flowko: only an active instance admin, as in the admin settings layout. The session role comes from the
  // database, so it still says ADMIN for an admin whom validateRole signed in as INACTIVE_ADMIN (no 2FA, weak
  // password).
  const user = await new UserRepository(prisma).findUnlockedUserForSession({ userId: session.user.id });
  if (!(await isActiveInstanceAdminSession(user, context.req))) {
    return {
      notFound: true,
    } as const;
  }

  return {
    props: {},
  };
};
