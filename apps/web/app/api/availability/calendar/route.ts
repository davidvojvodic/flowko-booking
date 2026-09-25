import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import {
  getCalendarCredentials,
  getConnectedCalendars,
} from "@calcom/features/calendars/lib/CalendarManager";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { HttpError } from "@calcom/lib/http-error";
import notEmpty from "@calcom/lib/notEmpty";
import { SelectedCalendarRepository } from "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository";
import prisma from "@calcom/prisma";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

const selectedCalendarSelectSchema = z.object({
  integration: z.string(),
  externalId: z.string(),
  credentialId: z.coerce.number(),
  delegationCredentialId: z.string().nullish().default(null),
  eventTypeId: z.coerce.number().nullish(),
});

async function authMiddleware() {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });

  if (!session?.user?.id) {
    throw new HttpError({ statusCode: 401, message: "Not authenticated" });
  }

  const userRepo = new UserRepository(prisma);
  const userWithCredentials = await userRepo.findUserWithCredentials({
    id: session.user.id,
  });

  if (!userWithCredentials) {
    throw new HttpError({ statusCode: 401, message: "Not authenticated" });
  }

  return userWithCredentials;
}

type UserWithCredentials = Awaited<ReturnType<typeof authMiddleware>>;

// Flowko: every client business is its own user on this instance. A SelectedCalendar row names a
// credential, a calendar and an event type, and Flowko's Google patches trust those fields across users
// (the grant-sharing check on disconnect), so a user may only name their own.
async function findOwnCalendarCredential(
  user: UserWithCredentials,
  {
    integration,
    credentialId,
    delegationCredentialId,
    eventTypeId,
  }: {
    integration: string;
    credentialId: number;
    delegationCredentialId: string | null;
    eventTypeId?: number | null;
  }
) {
  // Flowko: Cal.diy has no delegation credentials, so none can be the caller's
  if (delegationCredentialId) {
    throw new HttpError({ statusCode: 403, message: "Forbidden" });
  }
  const credential = user.credentials.find(({ id, type }) => id === credentialId && type === integration);
  if (!credential) {
    throw new HttpError({ statusCode: 403, message: "Forbidden" });
  }
  if (eventTypeId != null) {
    const eventType = await prisma.eventType.findFirst({
      where: { id: eventTypeId, userId: user.id },
      select: { id: true },
    });
    if (!eventType) {
      throw new HttpError({ statusCode: 403, message: "Forbidden" });
    }
  }
  return credential;
}

// TODO: It doesn't seem to be used from within the app. It is possible that someone outside Cal.diy is using this GET endpoint
async function getHandler() {
  const user = await authMiddleware();

  const selectedCalendarIds = await SelectedCalendarRepository.findMany({
    where: { userId: user.id },
    select: { externalId: true },
  });
  // get user's credentials + their connected integrations
  const calendarCredentials = getCalendarCredentials(user.credentials);
  // get all the connected integrations' calendars (from third party)
  const { connectedCalendars } = await getConnectedCalendars(
    calendarCredentials,
    user.userLevelSelectedCalendars
  );

  const calendars = connectedCalendars.flatMap((c) => c.calendars).filter(notEmpty);
  const selectableCalendars = calendars.map((cal) => {
    return { selected: selectedCalendarIds.findIndex((s) => s.externalId === cal.externalId) > -1, ...cal };
  });

  return NextResponse.json(selectableCalendars);
}

async function postHandler(req: NextRequest) {
  const user = await authMiddleware();

  const body = await req.json();
  const { integration, externalId, credentialId, eventTypeId, delegationCredentialId } =
    selectedCalendarSelectSchema.parse(body);

  const credential = await findOwnCalendarCredential(user, {
    integration,
    credentialId,
    delegationCredentialId,
    eventTypeId,
  });
  // Flowko: only a calendar this credential lists, like setDestinationCalendar, so a user cannot claim
  // another Google account's calendar id
  const { connectedCalendars } = await getConnectedCalendars(
    getCalendarCredentials([credential]),
    user.userLevelSelectedCalendars
  );
  const isListedCalendar = connectedCalendars
    .flatMap((c) => c.calendars ?? [])
    .some((cal) => cal.externalId === externalId && cal.credentialId === credential.id);
  if (!isListedCalendar) {
    throw new HttpError({ statusCode: 403, message: "Forbidden" });
  }

  await SelectedCalendarRepository.upsert({
    userId: user.id,
    integration,
    externalId,
    credentialId,
    delegationCredentialId,
    eventTypeId: eventTypeId ?? null,
  });

  return NextResponse.json({ message: "Calendar Selection Saved" });
}

async function deleteHandler(req: NextRequest) {
  const user = await authMiddleware();
  const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());

  const { integration, externalId, credentialId, eventTypeId, delegationCredentialId } =
    selectedCalendarSelectSchema.parse(searchParams);
  // Flowko: the delete only ever touches the caller's own rows, but it names a credential and an event
  // type too, and those must be the caller's. It does not ask Google, so a calendar Google stopped listing
  // can still be unselected.
  await findOwnCalendarCredential(user, { integration, credentialId, delegationCredentialId, eventTypeId });

  await SelectedCalendarRepository.delete({
    where: {
      userId: user.id,
      externalId,
      integration,
      eventTypeId: eventTypeId ?? null,
    },
  });

  return NextResponse.json({ message: "Calendar Selection Saved" });
}

export const POST = defaultResponderForAppDir(postHandler);
export const DELETE = defaultResponderForAppDir(deleteHandler);
export const GET = defaultResponderForAppDir(getHandler);
