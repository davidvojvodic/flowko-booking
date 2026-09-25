import { getTranslation } from "@calcom/i18n/server";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { CredentialPayload } from "@calcom/types/Credential";

const log = logger.getSubLogger({ prefix: ["invalidateCredential"] });

/**
 * Flowko: an invalid calendar credential that still has selected calendars blocks the host's booking page
 * (getCalendarsEvents fails closed), so the host must learn about it. Sent once, when the credential flips.
 * Only a host's own calendar connection is announced: a team's or a delegated one has nobody to reconnect it.
 * Best effort: it never throws, so a failed e-mail never fails the request that found the broken grant.
 */
const notifyHostOfBrokenCalendarConnection = async (credentialId: number) => {
  try {
    const credential = await prisma.credential.findUnique({
      where: { id: credentialId },
      select: {
        type: true,
        appId: true,
        userId: true,
        teamId: true,
        delegationCredentialId: true,
        user: { select: { email: true, name: true, locale: true } },
      },
    });
    if (
      !credential?.user ||
      !credential.userId ||
      credential.teamId ||
      credential.delegationCredentialId ||
      !credential.type.endsWith("_calendar")
    ) {
      return;
    }

    const [{ getAppFromSlug }, { sendBrokenCalendarConnectionEmail }, selectedCalendarCount] =
      await Promise.all([
        import("../utils"),
        import("@calcom/emails/integration-email-service"),
        // The host's own rows only: another tenant cannot make the e-mail claim a blocked page
        prisma.selectedCalendar.count({ where: { credentialId, userId: credential.userId } }),
      ]);
    const { user } = credential;
    await sendBrokenCalendarConnectionEmail({
      t: await getTranslation(user.locale ?? "en", "common"),
      userEmail: user.email,
      userName: user.name,
      appName: getAppFromSlug(credential.appId ?? undefined)?.name ?? credential.type,
      blocksBookingPage: selectedCalendarCount > 0,
    });
    log.info("Told the host that a calendar connection stopped working", { credentialId });
  } catch (error) {
    log.warn("Could not tell the host that a calendar connection stopped working", {
      credentialId,
      error: error instanceof Error ? error.name : "Unknown error",
    });
  }
};

export const invalidateCredential = async (credentialId: CredentialPayload["id"]) => {
  // Flowko: flip only a credential that is still valid, in one statement, so concurrent requests and
  // repeated failures flip it once and the host gets one e-mail per broken connection
  const { count } = await prisma.credential.updateMany({
    where: { id: credentialId, OR: [{ invalid: false }, { invalid: null }] },
    data: { invalid: true },
  });
  if (count !== 1) return;

  await notifyHostOfBrokenCalendarConnection(credentialId);
};
