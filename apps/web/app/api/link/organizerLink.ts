import process from "node:process";
import { LINK_TOKEN_KEY_LABEL, symmetricDecryptAuthenticated } from "@calcom/lib/crypto";
import prisma from "@calcom/prisma";
import { z } from "zod";

/**
 * Flowko (U8f): the organizer's confirm/reject link, shared by `/api/link` (GET shows, POST decides) and the
 * confirm page `/booking/link`. Resolving a link reads the booking and its organizer and never changes anything.
 */

export enum DirectAction {
  ACCEPT = "accept",
  REJECT = "reject",
}

/** Flowko (U8f): the first-party page the e-mailed link opens; only its button decides (POST /api/link). */
export const ORGANIZER_LINK_PAGE_PATH = "/booking/link";

/** Flowko (U8f): the rejection reason goes into the booker's e-mail; the page's field has the same limit. */
export const REJECTION_REASON_MAX_LENGTH = 2000;

const linkSchema = z.object({
  action: z.nativeEnum(DirectAction),
  token: z.string().min(1),
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
export const LINK_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

async function resolve(input: { token?: unknown; action?: unknown }) {
  const { action, token } = linkSchema.parse({ action: input.action, token: input.token });

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

  // Flowko (U8f): title and times are what the request e-mail shows the organizer; the confirm page shows
  // nothing else of the booking (no attendees, answers, location or description).
  const booking = await prisma.booking.findUnique({
    where: { uid: bookingUid },
    select: {
      id: true,
      uid: true,
      userId: true,
      recurringEventId: true,
      status: true,
      title: true,
      startTime: true,
      endTime: true,
    },
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
      // Flowko (U8f): the confirm page speaks the e-mail's language, time zone and clock.
      locale: true,
      timeZone: true,
      timeFormat: true,
    },
  });
  if (!user) return null;

  return {
    action,
    token,
    booking,
    user,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  };
}

export type ResolvedOrganizerLink = NonNullable<Awaited<ReturnType<typeof resolve>>>;

/**
 * Flowko: NAR-1. Every invalid link resolves to null, whatever failed (input, token encoding, auth tag, JSON,
 * schema, expiry, booking lookup, organizer mismatch, a database error), so callers answer every failure the
 * same way and no crypto or parse error message reaches a response. Never throws, never writes.
 */
export async function resolveOrganizerLink(input: {
  token?: unknown;
  action?: unknown;
}): Promise<ResolvedOrganizerLink | null> {
  try {
    return await resolve(input);
  } catch {
    return null;
  }
}
