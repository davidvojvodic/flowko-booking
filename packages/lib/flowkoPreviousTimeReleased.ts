/**
 * U17a (Flowko): a booking moved from another one has already released the original's time, because
 * createBooking cancels the original in the same transaction (except on seated event types). The request
 * and decline mails use this to tell the customer so. Plan B (U17) will change the request side; then this
 * must follow it.
 */
export const previousTimeReleased = ({
  rescheduledFromUid,
  seatsPerTimeSlot,
}: {
  rescheduledFromUid: string | null | undefined;
  seatsPerTimeSlot?: number | null;
}): boolean => !!rescheduledFromUid && !seatsPerTimeSlot;
