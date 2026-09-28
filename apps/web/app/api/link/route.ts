import { WEBAPP_URL } from "@calcom/lib/constants";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";
import { TRPCError } from "@trpc/server";
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { parseRequestData } from "app/api/parseRequestData";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DirectAction,
  ORGANIZER_LINK_PAGE_PATH,
  REJECTION_REASON_MAX_LENGTH,
  resolveOrganizerLink,
} from "./organizerLink";

// Flowko (U8f): every answer is a 303, so the browser follows it with a GET. NextResponse.redirect's default
// 307 would repeat the form POST against the booking page.
const seeOther = (path: string) => NextResponse.redirect(new URL(path, WEBAPP_URL), 303);

// Flowko: NAR-1. Every invalid link gets this one response, whatever failed, so no failure is distinguishable
// from another. Flowko (U8f): it opens the confirm page without a token, which says the link is not valid.
const invalidLinkResponse = () => seeOther(ORGANIZER_LINK_PAGE_PATH);

/**
 * Flowko (U8f, David 2026-09-28): a GET never decides a booking. Mail scanners (Outlook Safe Links, Mimecast,
 * Proofpoint) and link previews open every link in an e-mail, so the e-mailed accept/reject link used to accept
 * or reject a pending booking before the organizer saw it. The GET only checks the link (nothing is consumed or
 * written) and opens the confirm page, whose button POSTs the same token and action back here. The e-mails keep
 * their URLs, so links sent before U8f land on the confirm page too.
 */
async function getHandler(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const link = await resolveOrganizerLink({
    token: searchParams.get("token") ?? undefined,
    action: searchParams.get("action") ?? undefined,
  });
  if (!link) return invalidLinkResponse();

  // The page checks the link again and shows the booking's title and time, or that it no longer waits for a
  // decision. The token stays in the URL as it was in the e-mail's; nothing else is added.
  const page = new URL(ORGANIZER_LINK_PAGE_PATH, WEBAPP_URL);
  page.searchParams.set("token", link.token);
  page.searchParams.set("action", link.action);
  return NextResponse.redirect(page, 303);
}

const reasonSchema = z.string().max(REJECTION_REASON_MAX_LENGTH).optional();

/** Flowko (U8f): ids of the bookings a POST is deciding right now, in this process. */
const bookingIdsBeingDecided = new Set<number>();

/**
 * Flowko (U8f): the confirm page's button. The token and action come from the body only (form-encoded, as the
 * page's form sends them, or JSON); a token in the query is ignored. The token in the body is the authorisation,
 * so there is no cookie or session to forge: a cross-site form can only submit a token its author already holds.
 */
async function postHandler(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await parseRequestData(request);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    body = {};
  }

  const link = await resolveOrganizerLink({ token: body.token, action: body.action });
  if (!link) return invalidLinkResponse();

  // Flowko (U8f): a rejection's optional reason goes into the booker's e-mail. It is ignored on accept.
  let reason: string | undefined;
  if (link.action === DirectAction.REJECT) {
    const reasonResult = reasonSchema.safeParse(body.reason);
    if (!reasonResult.success) return invalidLinkResponse();
    reason = reasonResult.data?.trim() || undefined;
  }

  const {
    action,
    booking,
    user,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  } = link;
  const bookingUid = booking.uid;

  // Flowko (U8e): the link decides a booking only while the booking waits for that decision. The token is
  // not consumed and stays valid for 30 days, and the organizer's reply to the request email quotes it to the
  // booker (Reply-To is the attendees). confirmHandler refuses only an ACCEPTED booking, so the same link
  // turned the organizer's rejection into an acceptance, or brought back a cancelled booking. Any other
  // status now opens the booking as it is, without acting.
  if (booking.status !== BookingStatus.PENDING) {
    return seeOther(`/booking/${bookingUid}`);
  }

  // Flowko (U8f): one decision per booking at a time. A double click before the page has hydrated (its button
  // disables itself only after that) sends two POSTs that both read PENDING above; the second would reject
  // again and e-mail the booker twice. Inside the slot the status is read again, after any earlier decision
  // has been written. The slot is per process, which covers the single replica this app runs on.
  if (bookingIdsBeingDecided.has(booking.id)) return seeOther(`/booking/${bookingUid}`);
  bookingIdsBeingDecided.add(booking.id);
  try {
    const current = await prisma.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    if (current?.status !== BookingStatus.PENDING) return seeOther(`/booking/${bookingUid}`);

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
    return seeOther(`/booking/${bookingUid}?error=${encodeURIComponent(message)}`);
  } finally {
    bookingIdsBeingDecided.delete(booking.id);
  }

  return seeOther(`/booking/${bookingUid}`);
}

export const GET = defaultResponderForAppDir(getHandler);
export const POST = defaultResponderForAppDir(postHandler);
