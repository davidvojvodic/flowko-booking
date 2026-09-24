import process from "node:process";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { isActiveInstanceAdminSession } from "@calcom/features/auth/lib/isActiveInstanceAdmin";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import prisma from "@calcom/prisma";
import { UserPermissionRole } from "@calcom/prisma/enums";
import type { GetServerSidePropsContext } from "next";

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const { req } = context;

  const userCount = await prisma.user.count();

  const session = await getServerSession({ req });

  if (session?.user.role && session?.user.role !== UserPermissionRole.ADMIN) {
    return {
      notFound: true,
    } as const;
  }
  // Flowko: a signed-in visitor gets the setup pages only as an active instance admin, as in the admin settings
  // layout. The session role comes from the database, so it still says ADMIN for an admin whom validateRole
  // signed in as INACTIVE_ADMIN (no 2FA, weak password). Signed out, the page serves only a fresh install with
  // no user yet, where it creates the first admin; after that it would only tell anyone the user count.
  if (session) {
    const user = await new UserRepository(prisma).findUnlockedUserForSession({ userId: session.user.id });
    if (!(await isActiveInstanceAdminSession(user, req))) {
      return {
        notFound: true,
      } as const;
    }
  } else if (userCount > 0) {
    return {
      notFound: true,
    } as const;
  }
  // direct access is intentional.
  const deploymentRepo = { getLicenseKeyWithId: async (_id: number) => null as string | null };
  const licenseKey = await deploymentRepo.getLicenseKeyWithId(1);

  // Check existent CALCOM_LICENSE_KEY env var and account for it
  if (!!process.env.CALCOM_LICENSE_KEY && !licenseKey) {
    await prisma.deployment.upsert({
      where: { id: 1 },
      update: {
        licenseKey: process.env.CALCOM_LICENSE_KEY,
        agreedLicenseAt: new Date(),
      },
      create: {
        licenseKey: process.env.CALCOM_LICENSE_KEY,
        agreedLicenseAt: new Date(),
      },
    });
  }

  // Check if there's already a valid license using LicenseKeyService
  const hasValidLicense = false;

  const isFreeLicense = true;

  return {
    props: {
      isFreeLicense,
      userCount,
      hasValidLicense,
    },
  };
}
