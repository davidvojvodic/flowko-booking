import { getConnectedDestinationCalendarsAndEnsureDefaultsInDb } from "@calcom/features/calendars/lib/getConnectedDestinationCalendars";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import type { PrismaClient } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";

import type { TConnectedCalendarsInputSchema } from "./connectedCalendars.schema";

type ConnectedCalendarsOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TConnectedCalendarsInputSchema;
};

type GetConnectedDestinationCalendarsAndEnsureDefaultsInDbResult = Awaited<
  ReturnType<typeof getConnectedDestinationCalendarsAndEnsureDefaultsInDb>
>;

type ConnectedCalendarsHandlerResult = {
  destinationCalendar: GetConnectedDestinationCalendarsAndEnsureDefaultsInDbResult["destinationCalendar"];
  connectedCalendars: (GetConnectedDestinationCalendarsAndEnsureDefaultsInDbResult["connectedCalendars"][number] & {
    cacheUpdatedAt: null;
  })[];
};

export const connectedCalendarsHandler = async ({
  ctx: { user, prisma },
  input,
}: ConnectedCalendarsOptions): Promise<ConnectedCalendarsHandlerResult> => {
  const onboarding = input?.onboarding || false;
  const eventTypeId = input?.eventTypeId ?? null;

  // Flowko: every client business is its own user on this instance. The query writes a SelectedCalendar
  // row for this event type, so it must be the caller's own, as setDestinationCalendar checks it
  if (eventTypeId) {
    const eventType = await prisma.eventType.findFirst({
      where: { id: eventTypeId, userId: user.id },
      select: { id: true },
    });
    if (!eventType) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You don't have access to event type ${eventTypeId}`,
      });
    }
  }

  const { connectedCalendars, destinationCalendar } =
    await getConnectedDestinationCalendarsAndEnsureDefaultsInDb({
      user,
      onboarding,
      eventTypeId,
      skipSync: input?.skipSync ?? false,
      prisma,
    });

  const enrichedConnectedCalendars = connectedCalendars.map((calendar) => ({
    ...calendar,
    cacheUpdatedAt: null,
  }));

  return {
    connectedCalendars: enrichedConnectedCalendars,
    destinationCalendar,
  };
};
