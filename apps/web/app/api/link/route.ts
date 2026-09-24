import process from "node:process";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { LINK_TOKEN_KEY_LABEL, symmetricDecryptAuthenticated } from "@calcom/lib/crypto";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import prisma from "@calcom/prisma";
import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";
import { TRPCError } from "@trpc/server";
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

enum DirectAction {
  ACCEPT = "accept",
  REJECT = "reject",
}

const querySchema = z.object({
  action: z.nativeEnum(DirectAction),
  token: z.string(),
  reason: z.string().optional(),
});

const decryptedSchema = z.object({
  bookingUid: z.string(),
  userId: z.number().int(),
  // Flowko: issued-at in epoch seconds, set by OrganizerRequestEmail (see LINK_TOKEN_MAX_AGE_SECONDS).
  iat: z.number().int(),
  platformClientId: z.string().optional(),
  platformRescheduleUrl: z.string().optional(),
  platformCancelUrl: z.string().optional(),
  platformBookingUrl: z.string().optional(),
});

// Flowko: an emailed confirm/reject link stays usable for 30 days; after that the organizer confirms in-app.
const LINK_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Flowko: NAR-1. Every invalid link gets this one response, whatever failed (query, token encoding, auth
// tag, JSON, schema, expiry, booking lookup, organizer mismatch), so no failure is distinguishable from
// another and no crypto or parse error reaches defaultResponderForAppDir (it would echo error.message).
const invalidLinkResponse = (): NextResponse =>
  NextResponse.redirect(new URL("/bookings/unconfirmed", WEBAPP_URL));

async function resolveLink(searchParams: URLSearchParams) {
  const { action, token, reason } = querySchema.parse(Object.fromEntries(searchParams.entries()));

  // Flowko: the token is AES-256-GCM authenticated (tampered, forged and legacy CBC tokens throw here).
  const decryptedData = JSON.parse(
    symmetricDecryptAuthenticated(token, process.env.CALENDSO_ENCRYPTION_KEY || "", LINK_TOKEN_KEY_LABEL)
  );

  const {
    bookingUid,
    userId,
    iat,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  } = decryptedSchema.parse(decryptedData);

  // Flowko: expired links, and links issued in the future, are refused.
  const now = Math.floor(Date.now() / 1000);
  if (iat > now + 5 * 60 || now - iat > LINK_TOKEN_MAX_AGE_SECONDS) return null;

  const booking = await prisma.booking.findUnique({
    where: { uid: bookingUid },
    select: { id: true, uid: true, userId: true, recurringEventId: true },
  });

  // Flowko: the link must name the booking's own organizer; booking A with user B's id is refused.
  if (!booking || booking.userId === null || booking.userId !== userId) return null;

  // Flowko: act as the organizer loaded from the booking row, never as an id taken from the token alone.
  const user = await prisma.user.findUnique({
    where: { id: booking.userId },
    select: {
      id: true,
      uuid: true,
      email: true,
      username: true,
      role: true,
      destinationCalendar: true,
    },
  });
  if (!user) return null;

  return {
    action,
    reason,
    booking,
    user,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  };
}

async function handler(request: NextRequest) {
  let link: Awaited<ReturnType<typeof resolveLink>>;
  // Flowko: one try around parse + decrypt + schema + both lookups; every failure is the same response.
  try {
    link = await resolveLink(request.nextUrl.searchParams);
  } catch {
    link = null;
  }
  if (!link) return invalidLinkResponse();

  const {
    action,
    reason,
    booking,
    user,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  } = link;
  const bookingUid = booking.uid;

  try {
    await confirmHandler({
      ctx: {
        user: {
          id: user.id,
          uuid: user.uuid,
          email: user.email,
          username: user.username ?? "",
          role: user.role,
          destinationCalendar: user.destinationCalendar ?? null,
        },
        traceContext: distributedTracing.createTrace("confirm_booking_magic_link"),
      },
      input: {
        bookingId: booking.id,
        recurringEventId: booking.recurringEventId || undefined,
        confirmed: action === DirectAction.ACCEPT,
        reason,
        emailsEnabled: true,
        platformClientParams: platformClientId
          ? {
              platformClientId,
              platformRescheduleUrl,
              platformCancelUrl,
              platformBookingUrl,
            }
          : undefined,
      },
    });
  } catch (e) {
    let message = "Error confirming booking";
    if (e instanceof TRPCError) message = (e as TRPCError).message;
    return NextResponse.redirect(
      new URL(`/booking/${bookingUid}?error=${encodeURIComponent(message)}`, WEBAPP_URL)
    );
  }

  return NextResponse.redirect(new URL(`/booking/${bookingUid}`, WEBAPP_URL));
}

export const GET = defaultResponderForAppDir(handler);
