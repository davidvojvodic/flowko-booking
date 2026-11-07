// Flowko U27: Cal's own booking paths refuse business bookings (G1, G2). A business booking is written, moved and
// cancelled only by the Flowko services (step-aware, under the business lock); Cal's booking service, its cancel
// and its booking actions would bypass them. Uses the global client (P1 exception: the callers in Cal code have
// no `db`). The message is the code only, never an id or a slug. Server only.
import { HttpError } from "@calcom/lib/http-error";
import { prisma } from "@calcom/prisma";
import { TRPCError } from "@trpc/server";
import { businessBookingById, businessBookingByUid, mirrorOfEventType, nonOwnerMemberOf } from "./mirror";

type BookingRef = { id?: number; uid?: string };

function refusal(): HttpError {
  return new HttpError({ statusCode: 400, message: FLOWKO_BUSINESS_BOOKING });
}

async function isBusinessBooking(ref: BookingRef): Promise<boolean> {
  if (typeof ref.id === "number" && (await businessBookingById(prisma, ref.id))) return true;
  if (typeof ref.uid === "string" && ref.uid !== "" && (await businessBookingByUid(prisma, ref.uid)))
    return true;
  return false;
}

export const FLOWKO_BUSINESS_BOOKING = "flowko_business_booking";

/** G1: Cal's booking service never books a worker mirror (only the business writer does). */
export async function assertNotMirrorEventType(eventTypeId: number | null | undefined): Promise<void> {
  if (await mirrorOfEventType(prisma, eventTypeId)) throw refusal();
}

/**
 * G1 (D2 carried over to the API): Cal's booking service never books an event type owned by a WORKER or STAFF
 * member of a business, in any status. A business owner's own event types stay bookable.
 */
export async function assertNotNonOwnerMemberEventType(
  ownerUserId: number | null | undefined
): Promise<void> {
  if (ownerUserId === null || ownerUserId === undefined) return;
  if (await nonOwnerMemberOf(prisma, ownerUserId)) throw refusal();
}

/** G1 and W8: Cal's booking service (reschedule) and Cal's cancel refuse a business booking. */
export async function assertNotBusinessBooking(ref: BookingRef): Promise<void> {
  if (await isBusinessBooking(ref)) throw refusal();
}

/** G2: Cal's booking actions (tRPC) refuse a business booking. */
export async function assertNotBusinessBookingTrpc(ref: BookingRef): Promise<void> {
  if (await isBusinessBooking(ref))
    throw new TRPCError({ code: "FORBIDDEN", message: FLOWKO_BUSINESS_BOOKING });
}
